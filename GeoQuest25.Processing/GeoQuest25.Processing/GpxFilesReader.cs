using System.Collections.Concurrent;
using System.Xml.Linq;
using NetTopologySuite.Geometries;

namespace GeoQuest25.Processing
{
    public class GpxFilesReader
    {
        public async Task<GpxFile[]> ReadGpxFiles(string gpxFolderPath)
        {
            // array of all activity types with reflection
            var activityTypes = Enum.GetValues<ActivityType>().ToArray();
            var gpxFilesReadTask = activityTypes.Select(at => ReadGpxFiles(gpxFolderPath, at));
            var gpxFiles = await Task.WhenAll(gpxFilesReadTask);
            return gpxFiles.SelectMany(gf => gf).OrderBy(gf => gf.Date).ToArray();
        }

        private async Task<GpxFile[]> ReadGpxFiles(string gpxFolderPath, ActivityType activity)
        {
            var activityIdentifier = activity switch
            {
                ActivityType.OutdoorCycling => "Outdoor Cycling",
                ActivityType.OutdoorRunning => "Outdoor Running",
                ActivityType.OutdoorWalking => "Outdoor Walking",
                ActivityType.Hiking => "Hiking",
                ActivityType.Snowboarding => "Snowboarding",
                ActivityType.CrossCountrySkiing => "Cross Country Skiing",
                ActivityType.Skiing => "Downhill Skiing",
                _ => throw new ArgumentOutOfRangeException(nameof(activity), activity, null)
            };
            var gpxFilePaths = Directory.GetFiles(gpxFolderPath, "*.gpx").Where(f => f.Contains(activityIdentifier));
            var gpxFileReadTasks = gpxFilePaths.Select(gfp => ReadGpxFile(gfp, activity));
            var gpxFiles = await Task.WhenAll(gpxFileReadTasks);
            return gpxFiles.ToArray();
        }
        
        private static async Task<GpxFile> ReadGpxFile(string gpxFilePath, ActivityType activity)
        {
            var onlyFileName = Path.GetFileName(gpxFilePath);
            var dateString = onlyFileName.Substring(0, 10);
            var date = DateOnly.Parse(dateString);
            
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

            return new GpxFile
            {
                Activity = activity,
                Date = date,
                Points = points.ToArray()
            };
        }
    }
    
    public class GpxFile
    {
        public required ActivityType Activity { get; set; }
        public required DateOnly Date { get; set; }
        public required Point[] Points { get; set; }
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