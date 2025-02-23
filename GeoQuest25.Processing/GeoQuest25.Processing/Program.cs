using System.Collections.Concurrent;
using GeoQuest25.Processing;
using NetTopologySuite.Features;
using NetTopologySuite.IO;

var shapeFileReader = new ShapeFileReader();
var gpxFilesReader = new GpxFilesReader();

// read shape file and extract all swiss municipalities
var shapeFilePath = "/Users/raphi/Downloads/swissboundaries_gemeinden_3d_2025-01_2056_5728.shp/swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp";
var municipalities = shapeFileReader.ReadShapeFile(shapeFilePath);
Console.WriteLine($"Number of municipalities: {municipalities.Length}");

// read gpx files
var gpxFilesPath = "/Users/raphi/Library/Mobile Documents/iCloud~com~altifondo~HealthFit/Documents";
var gpxFiles = await gpxFilesReader.ReadGpxFiles(gpxFilesPath);
Console.WriteLine($"Number of gpx files: {gpxFiles.Length}");

// loop through all municipalities and check if a point of a gpx file is inside the municipality
var visited = new ConcurrentBag<Municipality>();
var todo = new ConcurrentBag<Municipality>();

Parallel.ForEach(municipalities, municipality =>
{
    var result = IsMunicipalityVisited(municipality, gpxFiles);
    
    var icon = result.visited ? "✅" : "❌";
    Console.WriteLine($"{icon}️ {municipality.Name}");
    if (result.visited)
    {
        municipality.FirstVisit = result.firstVisit;
        visited.Add(municipality);
    }
    else
    {
        todo.Add(municipality);
    }
});

await GenerateGeoJson(visited.ToArray(), $"/Users/raphi/Downloads/visited-{Guid.NewGuid()}.geojson");
await GenerateGeoJson(todo.ToArray(), $"/Users/raphi/Downloads/todo-{Guid.NewGuid()}.geojson");

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
        featureCollection.Add(feature);
    }

    // GeoJSON serialisieren
    var geoJsonWriter = new GeoJsonWriter();
    var geoJsonString = geoJsonWriter.Write(featureCollection);

    // In Datei schreiben
    await File.WriteAllTextAsync(outputPath, geoJsonString);
    Console.WriteLine($"GeoJSON wurde nach {outputPath} geschrieben.");
}