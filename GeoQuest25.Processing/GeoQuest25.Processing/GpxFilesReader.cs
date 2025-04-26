using System.Collections.Concurrent;
using System.Xml.Linq;
using NetTopologySuite.Geometries;

namespace GeoQuest25.Processing
{
    public abstract class GpxFilesReader
    {
        public static string[] GetGpxFilePaths(string gpxFolderPath, bool filterActivityTypes)
        {
            if (!filterActivityTypes)
            {
                return Directory.GetFiles(gpxFolderPath, "*.gpx");
            }
            
            var activityTypes = Enum.GetValues<ActivityType>();
            var activityTypeFiles = activityTypes.Select(at =>
            {
                var activityIdentifier = at switch
                {
                    ActivityType.OutdoorCycling => "Outdoor Cycling",
                    ActivityType.OutdoorRunning => "Outdoor Running",
                    ActivityType.OutdoorWalking => "Outdoor Walking",
                    ActivityType.Hiking => "Hiking",
                    ActivityType.Snowboarding => "Snowboarding",
                    ActivityType.CrossCountrySkiing => "Cross Country Skiing",
                    ActivityType.Skiing => "Downhill Skiing",
                    _ => throw new ArgumentOutOfRangeException(nameof(at), at, null)
                };
                var activityFiles = Directory.GetFiles(gpxFolderPath, "*.gpx").Where(f => f.Contains(activityIdentifier)).ToArray();
                return new { ActivityType = at, Files = activityFiles };
            }).ToArray();
                
            return activityTypeFiles.SelectMany(atf => atf.Files).ToArray();
        }

        public static async Task<GpxFile[]> ReadGpxFiles(string[] gpxFilePaths)
        {
            var gpxFileReadTasks = gpxFilePaths.Select(ReadGpxFile);
            var gpxFiles = await Task.WhenAll(gpxFileReadTasks);
            return gpxFiles.ToArray();
        }
        
        private static async Task<GpxFile> ReadGpxFile(string gpxFilePath)
        {
            // create text reader
            var reader = new StreamReader(gpxFilePath);
            var doc = await XDocument.LoadAsync(reader, LoadOptions.None, CancellationToken.None);
            var geometryFactory = new GeometryFactory();

            var trkpts = doc.Descendants().Where(x => x.Name.LocalName == "trkpt").ToArray();
            
            var firstTrkpt = trkpts.First();
            var timeString = firstTrkpt.Descendants().FirstOrDefault(x => x.Name.LocalName == "time")?.Value;
            var date = timeString is not null ? DateTime.Parse(timeString) : DateTime.MaxValue;
            var dateOnly = DateOnly.FromDateTime(date);

            var points = new ConcurrentBag<Point>();
            Parallel.ForEach(trkpts, trkpt =>
            {
                var latString = trkpt.Attribute("lat")?.Value;
                var lonString = trkpt.Attribute("lon")?.Value;
                var lat = double.Parse(latString ?? "0", System.Globalization.CultureInfo.InvariantCulture);
                var lon = double.Parse(lonString ?? "0", System.Globalization.CultureInfo.InvariantCulture);
                points.Add(geometryFactory.CreatePoint(new Coordinate(lon, lat)));
            });

            return new GpxFile
            {
                Date = dateOnly,
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
    }
}