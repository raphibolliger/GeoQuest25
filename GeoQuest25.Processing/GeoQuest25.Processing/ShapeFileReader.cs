using System.Text;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using ProjNet.CoordinateSystems;
using ProjNet.CoordinateSystems.Transformations;

namespace GeoQuest25.Processing
{
    public class ShapeFileReader
    {
        private readonly ICoordinateTransformation _transformer = CreateCoordinateTransformer();
        
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
        
        private Coordinate TransformCoordinate(Coordinate coordinate)
        {
            // original first coordinate 7.801844386861247      46.68652370661302
            // moved first coordinate    7.80086885215094       46.68463122547609
            // factor                    0.0009755347103        0.001892481137
    
            var transformed = _transformer.MathTransform.Transform([coordinate.X, coordinate.Y]);
            double correctedLon = transformed[0] - 0.0009755347103;
            double correctedLat = transformed[1] - 0.001892481137;
            return new Coordinate(correctedLon, correctedLat);
        }
        
        private static ICoordinateTransformation CreateCoordinateTransformer()
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
    }

    public class Municipality
    {
        public required string Name { get; init; }
        public required Feature Feature { get; init; }
        public DateOnly? FirstVisit { get; set; }
        public bool IsPlanned { get; set; }
    }
}