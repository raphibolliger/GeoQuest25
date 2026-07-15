using System.Text;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace GeoQuest25.Processing
{
    public class ShapeFileReader
    {
        public Municipality[] ReadShapeFile(string shapeFilePath)
        {
            var shapefileReader = new ShapefileDataReader(shapeFilePath, new GeometryFactory(), Encoding.GetEncoding("UTF-8"));
            var municipalities = new List<Municipality>();

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
                var area = attributes["GEM_FLAECH"]?.ToString() ?? "";
                var areaLake = attributes["SEE_FLAECH"]?.ToString() ?? "";

                if (area == areaLake)
                {
                    Console.WriteLine($"🌊 {name} wurde als See identifiziert und wird übersprungen.");
                    continue;
                }
                
                var transformedGeometry = TransformGeometry(geometry);
                var municipality = new Municipality
                {
                    Name = name,
                    Feature = new Feature(transformedGeometry, attributes)
                };
                municipalities.Add(municipality);
            }
            
            return municipalities.ToArray();
        }
        
        private Geometry TransformGeometry(Geometry geometry)
        {
            var geometryFactory = new GeometryFactory();
    
            if (geometry is MultiPolygon multiPolygon)
            {
                var polygons = multiPolygon.Geometries.Select(g =>
                {
                    if (g is not Polygon p)
                        throw new Exception($"Unsupported geometry type {g.GetType()}.");
                    
                    var coords = p.Shell.Coordinates.Select(TransformCoordinate).ToArray();
                    return geometryFactory.CreatePolygon(coords);
                }).ToArray();
                
                return geometryFactory.CreateMultiPolygon(polygons);
            }
            
            if (geometry is Polygon polygon)
            {
                var coords = polygon.Shell.Coordinates.Select(TransformCoordinate).ToArray();
                return geometryFactory.CreatePolygon(coords);
            }
    
            throw new Exception($"Unsupported geometry type {geometry.GetType()}.");
        }
        
        // official swisstopo approximation formulas for LV95 -> WGS84 ("Näherungslösung",
        // see "Formeln und Konstanten für die Berechnung der Schweizerischen schiefachsigen
        // Zylinderprojektion und der Transformation zwischen Koordinatensystemen"), accurate
        // to ~1m across Switzerland (~2.3m at the very western edge near Geneva) — validated
        // against the official geodesy.geo.admin.ch/reframe service
        private static Coordinate TransformCoordinate(Coordinate coordinate)
        {
            var y = (coordinate.X - 2_600_000d) / 1_000_000d;
            var x = (coordinate.Y - 1_200_000d) / 1_000_000d;

            var lambda = 2.6779094
                         + 4.728982 * y
                         + 0.791484 * y * x
                         + 0.1306 * y * x * x
                         - 0.0436 * y * y * y;
            var phi = 16.9023892
                      + 3.238272 * x
                      - 0.270978 * y * y
                      - 0.002528 * x * x
                      - 0.0447 * y * y * x
                      - 0.0140 * x * x * x;

            // the formulas yield values in the unit 10000" — factor 100/36 converts to degrees
            return new Coordinate(lambda * 100 / 36, phi * 100 / 36);
        }
    }

    public class Municipality
    {
        public required string Name { get; init; }
        public required Feature Feature { get; init; }
        public DateOnly? FirstVisit { get; set; }
        public bool IsPlanned { get; set; }
    }
}