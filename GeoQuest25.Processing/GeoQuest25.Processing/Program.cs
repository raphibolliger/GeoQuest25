using System.Diagnostics;
using GeoQuest25.Processing;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Prepared;
using NetTopologySuite.Index.Strtree;
using NetTopologySuite.IO;

var stopwatch = Stopwatch.StartNew();
var shapeFileReader = new ShapeFileReader();

// read shape file and extract all swiss municipalities
var shapeFilePath = "/Users/raphi/Downloads/swissboundaries_gemeinden_3d_2025-01_2056_5728.shp/swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp";
var municipalities = shapeFileReader.ReadShapeFile(shapeFilePath);
Console.WriteLine($"Number of municipalities: {municipalities.Length} ({stopwatch.Elapsed.TotalSeconds:F1}s)");

// read done activities gpx files, sorted oldest first so the first match per municipality is the earliest visit
const string doneActivitiesFolderPath = "/Users/raphi/Library/CloudStorage/Dropbox-YARXGmbH/Raphael Bolliger/Apps/HealthFitExporter";
var doneActivitiesFilePaths = GpxFilesReader.GetGpxFilePaths(doneActivitiesFolderPath, true);
var doneGpxFiles = GpxFilesReader.ReadGpxFiles(doneActivitiesFilePaths).OrderBy(f => f.Date).ToArray();
Console.WriteLine($"Number of gpx files from already done activities: {doneGpxFiles.Length} ({stopwatch.Elapsed.TotalSeconds:F1}s)");

// read planned activities gpx files
const string plannedActivitiesFolderPath = "/Users/raphi/Library/Mobile Documents/com~apple~CloudDocs/01 Dokumente/03 Gpx Tours";
var plannedActivitiesFilePaths = GpxFilesReader.GetGpxFilePaths(plannedActivitiesFolderPath, false);
var plannedGpxFiles = GpxFilesReader.ReadGpxFiles(plannedActivitiesFilePaths);
Console.WriteLine($"Number of gpx files from planned activities: {plannedGpxFiles.Length} ({stopwatch.Elapsed.TotalSeconds:F1}s)");

// prepare the municipality geometries: a prepared geometry answers point-in-polygon
// queries via an internal index instead of rebuilding the topology graph per call
var entries = new MunicipalityEntry[municipalities.Length];
Parallel.For(0, municipalities.Length, i =>
{
    var geometry = municipalities[i].Feature.Geometry;
    var prepared = PreparedGeometryFactory.Prepare(geometry);
    // the point-in-area index inside the prepared geometry is built lazily on first
    // use; trigger it here while the instance is still confined to a single thread
    prepared.Contains(geometry.Factory.CreatePoint(geometry.Coordinate));
    entries[i] = new MunicipalityEntry(municipalities[i], geometry.EnvelopeInternal, prepared);
});

// spatial index so each gpx point only gets tested against the few municipalities
// whose bounding box contains it, instead of every municipality against every point
var municipalityIndex = new STRtree<MunicipalityEntry>();
foreach (var entry in entries)
    municipalityIndex.Insert(entry.Envelope, entry);
municipalityIndex.Build();
Console.WriteLine($"Spatial index built ({stopwatch.Elapsed.TotalSeconds:F1}s)");

// done activities: files are sorted by date, so a municipality that already has a
// FirstVisit can be skipped for all later files; the spatial index is queried once
// per file (with the whole track's envelope), per point only cheap envelope checks
// against the remaining candidates are needed
foreach (var gpxFile in doneGpxFiles)
{
    var candidates = UnvisitedCandidates(municipalityIndex, gpxFile);
    if (candidates.Length == 0) continue;

    Parallel.ForEach(gpxFile.Points, point =>
    {
        foreach (var candidate in candidates)
        {
            if (candidate.Municipality.FirstVisit is not null) continue;
            if (!candidate.Envelope.Contains(point.Coordinate)) continue;
            if (!candidate.Prepared.Contains(point)) continue;
            lock (candidate)
            {
                candidate.Municipality.FirstVisit ??= gpxFile.Date;
            }
        }
    });
}

// planned activities: only municipalities that are still todo are of interest
foreach (var gpxFile in plannedGpxFiles)
{
    var candidates = UnvisitedCandidates(municipalityIndex, gpxFile);

    Parallel.ForEach(gpxFile.Points, point =>
    {
        foreach (var candidate in candidates)
        {
            if (candidate.Municipality.IsPlanned) continue;
            if (!candidate.Envelope.Contains(point.Coordinate)) continue;
            if (candidate.Prepared.Contains(point))
                candidate.Municipality.IsPlanned = true;
        }
    });
}

Console.WriteLine($"Matching done ({stopwatch.Elapsed.TotalSeconds:F1}s)");

var visited = new List<Municipality>();
var todo = new List<Municipality>();
foreach (var municipality in municipalities)
{
    if (municipality.FirstVisit is not null)
        visited.Add(municipality);
    else
        todo.Add(municipality);

    var icon = municipality.FirstVisit is not null ? "✅" : "❌";
    var output = $"{icon}  {municipality.Name}";
    if (municipality.IsPlanned) output += " -> 🗓️";
    Console.WriteLine(output);
}

// SPECIAL CASE: there are two areas (tracked as municipalities) which are not realy municipalities, this areas are owned by two municipalities if one of
// them is visited, the area is considered as visited too
var cadenazzoMonteceneri = visited.Any(vm => vm.Name is "Cadenazzo" or "Monteceneri");
if (cadenazzoMonteceneri)
{
    var toMove = municipalities.Single(m => m.Name == "Comunanza Cadenazzo/Monteceneri");
    if (todo.Remove(toMove))
        visited.Add(toMove);
}

var capriscaLugano = visited.Any(vm => vm.Name is "Capriasca" or "Lugano");
if (capriscaLugano)
{
    var toMove = municipalities.Single(m => m.Name == "Comunanza Capriasca/Lugano");
    if (todo.Remove(toMove))
        visited.Add(toMove);
}

// delete old geojson files and remove old ones
var frontendPaht = SearchFrontendPath();
if (frontendPaht is null)
    throw new ApplicationException("Frontend assets path is null. Updating geojson files not possible.");

var assetsPath = Path.Combine(frontendPaht, "src/assets");
var geojsonAssetFiles = Directory.GetFiles(assetsPath, "*.geojson");

var existingVisitedFilePath = geojsonAssetFiles.Single(f => f.Contains("visited-"));
var existingVisitedFile = new FileInfo(existingVisitedFilePath);
File.Delete(existingVisitedFilePath);

var existingTodoFilePath = geojsonAssetFiles.Single(f => f.Contains("todo-"));
var existingTodoFile = new FileInfo(existingTodoFilePath);
File.Delete(existingTodoFilePath);

var newVisitedFileName = $"visited-{Guid.NewGuid()}.geojson";
await GenerateGeoJson(visited.ToArray(), $"{assetsPath}/{newVisitedFileName}");

var newTodoFileName = $"todo-{Guid.NewGuid()}.geojson";
await GenerateGeoJson(todo.ToArray(), $"{assetsPath}/{newTodoFileName}");

// replace geosjon reference in app.component.ts
var appComponentPath = Path.Combine(frontendPaht, "src/app/app.component.ts");

var appComponentContent = await File.ReadAllTextAsync(appComponentPath);
var newAppComponentContent = appComponentContent.Replace(existingVisitedFile.Name, newVisitedFileName).Replace(existingTodoFile.Name, newTodoFileName);

await File.WriteAllTextAsync(appComponentPath, newAppComponentContent);

Console.WriteLine($"Finished ({stopwatch.Elapsed.TotalSeconds:F1}s)");

return;

// the municipalities whose bounding box intersects the track's bounding box and
// which have not been visited yet — the only ones worth testing per point
static MunicipalityEntry[] UnvisitedCandidates(STRtree<MunicipalityEntry> index, GpxFile gpxFile)
{
    var trackEnvelope = new Envelope();
    foreach (var point in gpxFile.Points)
        trackEnvelope.ExpandToInclude(point.Coordinate);

    return index.Query(trackEnvelope).Where(c => c.Municipality.FirstVisit is null).ToArray();
}

static async Task GenerateGeoJson(Municipality[] municipalities, string outputPath)
{
    // FeatureCollection für GeoJSON erstellen
    var featureCollection = new FeatureCollection();
    foreach (var gemeinde in municipalities)
    {
        var feature = new Feature
        {
            Geometry = gemeinde.Feature.Geometry,
            Attributes = new AttributesTable()
        };
        feature.Attributes.Add("name", gemeinde.Name);
        if (gemeinde.FirstVisit is not null)
            feature.Attributes.Add("firstVisit", gemeinde.FirstVisit);
        if (gemeinde.IsPlanned)
            feature.Attributes.Add("planned", true);
        featureCollection.Add(feature);
    }

    // GeoJSON serialisieren
    var geoJsonWriter = new GeoJsonWriter();
    var geoJsonString = geoJsonWriter.Write(featureCollection);

    // In Datei schreiben
    await File.WriteAllTextAsync(outputPath, geoJsonString);
    Console.WriteLine($"GeoJSON wurde nach {outputPath} geschrieben.");
}

string? SearchFrontendPath()
{
    var currentDirectory = Directory.GetCurrentDirectory();
    while (currentDirectory is not null)
    {
        var direcotryInfo = new DirectoryInfo(currentDirectory);
        var directories = direcotryInfo.GetDirectories();
        if (directories.Any(d => d.Name == "GeoQuest25.Frontend"))
        {
            var path = Path.Combine(currentDirectory, "GeoQuest25.Frontend");
            return Directory.Exists(path) ? path : null;
        }

        currentDirectory = Directory.GetParent(currentDirectory)?.FullName;
    }
    return currentDirectory;
}

internal sealed record MunicipalityEntry(Municipality Municipality, Envelope Envelope, IPreparedGeometry Prepared);
