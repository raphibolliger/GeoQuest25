using System.Diagnostics;
using System.Globalization;
using System.Text;
using NetTopologySuite.Geometries;
using NetTopologySuite.Simplify;

namespace GeoQuest25.Processing
{
    public abstract class TrackExporter
    {
        private static readonly GeometryFactory GeometryFactory = new();

        // ~5m; the tracks only need to be visually accurate, tippecanoe simplifies
        // further per zoom level anyway
        private const double SimplifyToleranceDegrees = 0.00005;

        public static void ExportPmTiles(GpxFile[] gpxFiles, string outputFilePath)
        {
            var inputFilePath = Path.Combine(Path.GetTempPath(), $"geoquest-tracks-{Guid.NewGuid()}.geojsonl");
            try
            {
                WriteLineDelimitedGeoJson(gpxFiles, inputFilePath);
                RunTippecanoe(inputFilePath, outputFilePath);
            }
            finally
            {
                File.Delete(inputFilePath);
            }
        }

        private static void WriteLineDelimitedGeoJson(GpxFile[] gpxFiles, string inputFilePath)
        {
            var lines = new string?[gpxFiles.Length];
            Parallel.For(0, gpxFiles.Length, i =>
            {
                var gpxFile = gpxFiles[i];
                if (gpxFile.Points.Length < 2) return;

                var lineString = GeometryFactory.CreateLineString(gpxFile.Points.Select(p => p.Coordinate).ToArray());
                var simplified = DouglasPeuckerSimplifier.Simplify(lineString, SimplifyToleranceDegrees);
                if (simplified.Coordinates.Length < 2) return;

                lines[i] = BuildFeatureLine(simplified.Coordinates, gpxFile.Date);
            });

            using var writer = new StreamWriter(inputFilePath, false, Encoding.UTF8);
            foreach (var line in lines)
            {
                if (line is not null)
                    writer.WriteLine(line);
            }
        }

        private static string BuildFeatureLine(Coordinate[] coordinates, DateOnly date)
        {
            var builder = new StringBuilder(coordinates.Length * 20);
            builder.Append($"{{\"type\":\"Feature\",\"properties\":{{\"date\":\"{date:yyyy-MM-dd}\"}},\"geometry\":{{\"type\":\"LineString\",\"coordinates\":[");

            // 5 decimal places (~1m) is plenty for display and keeps the intermediate file small
            double previousLon = double.NaN, previousLat = double.NaN;
            var first = true;
            foreach (var coordinate in coordinates)
            {
                var lon = Math.Round(coordinate.X, 5);
                var lat = Math.Round(coordinate.Y, 5);
                if (lon == previousLon && lat == previousLat) continue;
                previousLon = lon;
                previousLat = lat;

                if (!first) builder.Append(',');
                first = false;
                builder.Append('[').Append(lon.ToString(CultureInfo.InvariantCulture)).Append(',').Append(lat.ToString(CultureInfo.InvariantCulture)).Append(']');
            }

            builder.Append("]}}");
            return builder.ToString();
        }

        private static void RunTippecanoe(string inputFilePath, string outputFilePath)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "tippecanoe",
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add("-o");
            startInfo.ArgumentList.Add(outputFilePath);
            startInfo.ArgumentList.Add("-l");
            startInfo.ArgumentList.Add("tracks");
            startInfo.ArgumentList.Add("-Z4");
            startInfo.ArgumentList.Add("-z13");
            startInfo.ArgumentList.Add("-P");
            startInfo.ArgumentList.Add("--force");
            startInfo.ArgumentList.Add("-q");
            startInfo.ArgumentList.Add(inputFilePath);

            using var process = Process.Start(startInfo) ?? throw new ApplicationException("Failed to start tippecanoe.");
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new ApplicationException($"tippecanoe failed with exit code {process.ExitCode}: {stderr}");
        }
    }
}
