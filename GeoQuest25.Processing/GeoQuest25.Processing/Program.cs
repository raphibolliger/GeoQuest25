using System.Collections.Concurrent;
using GeoQuest25.Processing;
using NetTopologySuite.Features;
using NetTopologySuite.IO;

var shapeFileReader = new ShapeFileReader();

// read shape file and extract all swiss municipalities
var shapeFilePath = "/Users/raphi/Downloads/swissboundaries_gemeinden_3d_2025-01_2056_5728.shp/swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp";
var municipalities = shapeFileReader.ReadShapeFile(shapeFilePath);
Console.WriteLine($"Number of municipalities: {municipalities.Length}");

// read done activities gpx files
const string doneActivitiesFolderPath = "/Users/raphi/Library/Mobile Documents/iCloud~com~altifondo~HealthFit/Documents";
var doneActivitiesFilePaths = GpxFilesReader.GetGpxFilePaths(doneActivitiesFolderPath, true);
var doneGpxFiles = await GpxFilesReader.ReadGpxFiles(doneActivitiesFilePaths);
Console.WriteLine($"Number of gpx files from already done activities: {doneGpxFiles.Length}");

// read planned activities gpx files
const string plannedActivitiesFolderPath = "/Users/raphi/Library/Mobile Documents/com~apple~CloudDocs/01 Dokumente/03 Gpx Tours";
var plannedActivitiesFilePaths = GpxFilesReader.GetGpxFilePaths(plannedActivitiesFolderPath, false);
var plannedGpxFiles = await GpxFilesReader.ReadGpxFiles(plannedActivitiesFilePaths);
Console.WriteLine($"Number of gpx files from planned activities: {plannedGpxFiles.Length}");

// loop through all municipalities and check if a point of a gpx file is inside the municipality
var visited = new ConcurrentBag<Municipality>();
var todo = new ConcurrentBag<Municipality>();

Parallel.ForEach(municipalities, municipality =>
{
    var result = IsMunicipalityVisited(municipality, doneGpxFiles);
    if (result.visited)
    {
        municipality.FirstVisit = result.firstVisit;
        visited.Add(municipality);
    }
    else
    {
        municipality.IsPlanned = IsMunicipalityVisited(municipality, plannedGpxFiles).visited;
        todo.Add(municipality);
    }
    
    var icon = result.visited ? "✅" : "❌";
    var output = $"{icon}  {municipality.Name}";
    if (municipality.IsPlanned) output += " -> 🗓️";
    Console.WriteLine(output);
});

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

return;

static (bool visited, DateOnly? firstVisit) IsMunicipalityVisited(Municipality municipality, GpxFile[] gpxFiles)
{
    foreach (var gpxFile in gpxFiles)
    {
        foreach (var point in gpxFile.Points)
        {
            if (municipality.Feature.Geometry.Contains(point))
            {
                return (true, gpxFile.Date);
            }
        }
    }
    return (false, null);
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