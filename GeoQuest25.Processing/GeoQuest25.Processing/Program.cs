// See https://aka.ms/new-console-template for more information

using System.Collections.Concurrent;
using System.Text;
using System.Xml.Linq;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using ProjNet.CoordinateSystems;
using ProjNet.CoordinateSystems.Transformations;

// transform
var transformer = CreateCoordinateTransformer();
TestTransformation(transformer);

// read shapefile
var shapeFilePath = "/Users/raphi/Downloads/swissboundaries_gemeinden_3d_2025-01_2056_5728.shp/swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp";
Encoding encoding = Encoding.GetEncoding("UTF-8");
var shapefileReader = new ShapefileDataReader(shapeFilePath, new GeometryFactory(), encoding);
var gemeinden = new List<Feature>();

while (shapefileReader.Read())
{
    var geometry = shapefileReader.Geometry;
    var attributes = new AttributesTable();
    for (int i = 0; i < shapefileReader.DbaseHeader.NumFields; i++)
    {
        var fieldName = shapefileReader.DbaseHeader.Fields[i].Name;
        var fieldValue = shapefileReader.GetValue(i + 1);
        attributes.Add(fieldName, fieldValue);
    }

    var name = attributes["NAME"].ToString() ?? "";
    var flaeche = attributes["GEM_FLAECH"]?.ToString() ?? "";
    var seeFlaeche = attributes["SEE_FLAECH"]?.ToString() ?? "";

    if (flaeche == seeFlaeche)
    {
        Console.WriteLine($"🌊 {name} wurde als See identifiziert und wird übersprungen.");
        continue;
    }

    try
    {
        var transformedGeometry = TransformGeometry(geometry, transformer, name);
        gemeinden.Add(new Feature(transformedGeometry, attributes));
    }
    catch (Exception e)
    {
        Console.WriteLine($"Error transforming geometry: {e.Message} - {attributes["NAME"]}");
    }
}

Console.WriteLine($"Number of gemeinden: {gemeinden.Count}");

// read gpx files
var gpxFilesPath = "/Users/raphi/Library/Mobile Documents/iCloud~com~altifondo~HealthFit/Documents";
var gpxFiles = Directory.GetFiles(gpxFilesPath, "*.gpx").Where(f => f.Contains("Outdoor Cycling") || f.Contains("Outdoor Running") || f.Contains("Hiking")).ToList();
var gpxPointsReadTasks = gpxFiles.Select(ReadGpxFile);
var gpxPoints = await Task.WhenAll(gpxPointsReadTasks);
var points = gpxPoints.SelectMany(p => p).ToList();

//var points = new List<Point>();

Console.WriteLine($"Number of points: {points.Count}");

var visited = new ConcurrentBag<Feature>();

Parallel.ForEach(gemeinden, gemeinde =>
{
    var wasThere = false;
    foreach (var point in points)
    {
        if (gemeinde.Geometry.Contains(point))
        {
            visited.Add(gemeinde);
            wasThere = true;
            break; // Weiter zum nächsten Punkt, da ein Punkt nur in einer Gemeinde liegen kann
        }
    }
    
    var icon = wasThere ? "✅" : "❌";
    Console.WriteLine($"{icon}️ {gemeinde.Attributes["NAME"]}");
});

Console.WriteLine($"Number of visited gemeinden: {visited.Count}");

var outputPath = "/Users/raphi/Downloads/visited_gemeinden.geojson";
GenerateGeoJson(gemeinden, visited.ToList(), outputPath);

static async Task<Point[]> ReadGpxFile(string gpxFilePath)
{
    // create text reader
    var reader = new StreamReader(gpxFilePath);
    var doc = await XDocument.LoadAsync(reader, LoadOptions.None, CancellationToken.None);
    var points = new ConcurrentBag<Point>();
    var geometryFactory = new GeometryFactory();

    var trkpts = doc.Descendants().Where(x => x.Name.LocalName == "trkpt");

    Parallel.ForEach(trkpts, trkpt =>
    {
        var latString = trkpt.Attribute("lat")?.Value;
        var lonString = trkpt.Attribute("lon")?.Value;
        
        double lat = double.Parse(latString ?? "0", System.Globalization.CultureInfo.InvariantCulture);
        double lon = double.Parse(lonString ?? "0", System.Globalization.CultureInfo.InvariantCulture);
        points.Add(geometryFactory.CreatePoint(new Coordinate(lon, lat)));
    });
    
    return points.ToArray();
}

static Geometry TransformGeometry(Geometry geometry, ICoordinateTransformation transformer, string name)
{
    var geometryFactory = new GeometryFactory();
    
    if (geometry is MultiPolygon multiPolygon)
    {
        var polygons = multiPolygon.Geometries.Select(g =>
        {
            if (g is not Polygon p) throw new Exception($"Unsupported geometry type. Gemeinde: {name}");
            var coords = p.Shell.Coordinates.Select(c => TransformCoordinate(c, transformer)).ToArray();
            return geometryFactory.CreatePolygon(coords);
        }).ToArray();
        return geometryFactory.CreateMultiPolygon(polygons);
    }
    if (geometry is Polygon polygon)
    {
        var coords = polygon.Shell.Coordinates.Select(c => TransformCoordinate(c, transformer)).ToArray();
        return geometryFactory.CreatePolygon(coords);
    }
    
    throw new Exception($"Unsupported geometry type. Gemeinde: {name}");
}

static ICoordinateTransformation CreateCoordinateTransformer()
{
    var ctf = new CoordinateTransformationFactory();
    var csFactory = new CoordinateSystemFactory();

    // CH1903+ / LV95 (EPSG:2056) Definition aus der .prj-Datei
    string ch1903Lv95Wkt = @"
            PROJCS[""CH1903+_LV95"",
                GEOGCS[""GCS_CH1903+"",
                    DATUM[""D_CH1903+"",
                        SPHEROID[""Bessel_1841"",6377397.155,299.1528128]],
                    PRIMEM[""Greenwich"",0.0],
                    UNIT[""Degree"",0.0174532925199433]],
                PROJECTION[""Hotine_Oblique_Mercator_Azimuth_Center""],
                PARAMETER[""False_Easting"",2600000.0],
                PARAMETER[""False_Northing"",1200000.0],
                PARAMETER[""Scale_Factor"",1.0],
                PARAMETER[""Azimuth"",90.0],
                PARAMETER[""Longitude_Of_Center"",7.439583333333333],
                PARAMETER[""Latitude_Of_Center"",46.95240555555556],
                PARAMETER[""rectified_grid_angle"",90.0],
                UNIT[""Meter"",1.0]]";
    
    var ch1903Lv95 = csFactory.CreateFromWkt(ch1903Lv95Wkt);

    // Zielsystem: WGS84 (EPSG:4326)
    var wgs84 = GeographicCoordinateSystem.WGS84;

    return ctf.CreateFromCoordinateSystems(ch1903Lv95, wgs84);
}

static void GenerateGeoJson(List<Feature> allGemeinden, List<Feature> visitedGemeinden, string outputPath)
{
    // FeatureCollection für GeoJSON erstellen
    var featureCollection = new FeatureCollection();

    // Farben definieren
    string visitedColor = "#0000FF"; // Grün
    string notVisitedColor = "#FFFFFF"; // Weiß

    // Alle Gemeinden durchlaufen und Features erstellen
    foreach (var gemeinde in allGemeinden)
    {
        var gemeindeName = gemeinde.Attributes["NAME"].ToString();
        var feature = new Feature
        {
            Geometry = gemeinde.Geometry,
            Attributes = new AttributesTable()
        };
        
        feature.Attributes.Add("name", gemeindeName);

        // Farbe basierend auf Besuchsstatus setzen
        bool isVisited = visitedGemeinden.Contains(gemeinde);
        feature.Attributes.Add("fill", isVisited ? visitedColor : notVisitedColor);

        featureCollection.Add(feature);
    }

    // GeoJSON serialisieren
    var geoJsonWriter = new GeoJsonWriter();
    string geoJsonString = geoJsonWriter.Write(featureCollection);

    // In Datei schreiben
    File.WriteAllText(outputPath, geoJsonString);
    Console.WriteLine($"GeoJSON wurde nach {outputPath} geschrieben.");
}

static Coordinate TransformCoordinate(Coordinate coordinate, ICoordinateTransformation transformer)
{
    // original first coordinate 7.801844386861247      46.68652370661302
    // moved first coordinate    7.80086885215094       46.68463122547609
    
    // factor                    0.0009755347103        0.001892481137
    
    
    var transformed = transformer.MathTransform.Transform([coordinate.X, coordinate.Y]);
    double correctedLon = transformed[0] - 0.0009755347103;
    double correctedLat = transformed[1] - 0.001892481137;
    return new Coordinate(correctedLon, correctedLat);
}

static void TestTransformation(ICoordinateTransformation transformer)
{
    var testPoint = new[] { 2600000.0, 1200000.0 };
    var transformed = transformer.MathTransform.Transform(testPoint);
    Console.WriteLine($"CH1903+ / LV95 (2600000, 1200000) -> WGS84: Lon={transformed[0]}, Lat={transformed[1]}");
    Console.WriteLine($"Erwartet: Lon=7.4395833, Lat=46.9524056");
    
    double correctedLon = transformed[0];
    double correctedLat = transformed[1] - 0.0005969317532;
    Console.WriteLine($"CH1903+ / LV95 (2600000, 1200000) -> WGS84: Lon={correctedLon}, Lat={correctedLat}");
    Console.WriteLine($"Erwartet: Lon=7.4395833, Lat=46.9524056");
}