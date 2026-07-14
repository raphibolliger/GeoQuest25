using System.Globalization;
using System.Xml;
using NetTopologySuite.Geometries;

namespace GeoQuest25.Processing
{
    public abstract class GpxFilesReader
    {
        private static readonly GeometryFactory GeometryFactory = new();

        public static string[] GetGpxFilePaths(string gpxFolderPath, bool filterActivityTypes)
        {
            var gpxFilePaths = Directory.GetFiles(gpxFolderPath, "*.gpx");
            if (!filterActivityTypes)
            {
                return gpxFilePaths;
            }

            var activityIdentifiers = Enum.GetValues<ActivityType>().Select(at => at switch
            {
                ActivityType.OutdoorCycling => "Outdoor Cycling",
                ActivityType.OutdoorRunning => "Outdoor Running",
                ActivityType.OutdoorWalking => "Outdoor Walking",
                ActivityType.Hiking => "Hiking",
                ActivityType.Snowboarding => "Snowboarding",
                ActivityType.CrossCountrySkiing => "Cross Country Skiing",
                ActivityType.Skiing => "Downhill Skiing",
                ActivityType.Rowing => "Rowing",
                _ => throw new ArgumentOutOfRangeException(nameof(at), at, null)
            }).ToArray();

            return gpxFilePaths.Where(f => activityIdentifiers.Any(f.Contains)).ToArray();
        }

        public static GpxFile[] ReadGpxFiles(string[] gpxFilePaths)
        {
            var gpxFiles = new GpxFile[gpxFilePaths.Length];
            Parallel.For(0, gpxFilePaths.Length, i =>
            {
                gpxFiles[i] = ReadGpxFile(gpxFilePaths[i]);
            });
            return gpxFiles;
        }

        private static GpxFile ReadGpxFile(string gpxFilePath)
        {
            var settings = new XmlReaderSettings { IgnoreWhitespace = true, IgnoreComments = true };
            using var reader = XmlReader.Create(gpxFilePath, settings);

            DateOnly? date = null;
            var firstTrkptSeen = false;
            var points = new List<Point>();

            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element) continue;

                if (reader.LocalName == "trkpt")
                {
                    firstTrkptSeen = true;
                    var lat = double.Parse(reader.GetAttribute("lat") ?? "0", CultureInfo.InvariantCulture);
                    var lon = double.Parse(reader.GetAttribute("lon") ?? "0", CultureInfo.InvariantCulture);
                    points.Add(GeometryFactory.CreatePoint(new Coordinate(lon, lat)));
                }
                else if (date is null && firstTrkptSeen && reader.LocalName == "time")
                {
                    // the <time> of the first trkpt determines the activity date
                    date = DateOnly.FromDateTime(DateTime.Parse(reader.ReadElementContentAsString()));
                }
            }

            return new GpxFile
            {
                Date = date ?? DateOnly.FromDateTime(DateTime.MaxValue),
                Points = points.ToArray()
            };
        }
    }

    public class GpxFile
    {
        public required DateOnly Date { get; init; }
        public required Point[] Points { get; init; }
    }

    public enum ActivityType
    {
        OutdoorCycling,
        OutdoorRunning,
        OutdoorWalking,
        Hiking,
        Snowboarding,
        CrossCountrySkiing,
        Skiing,
        Rowing
    }
}
