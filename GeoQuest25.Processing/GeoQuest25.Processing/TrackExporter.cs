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

        // only split on very large gaps: those come from pausing the recording and resuming
        // far away — e.g. a train ride between two stations — which would otherwise draw a
        // straight line across the countryside. the threshold is deliberately high so that
        // ordinary gps drop-outs (short tunnels, lost signal) keep their connecting line.
        private const double MaxPointGapMeters = 5_000;

        /// <summary>
        /// Vector tiles, for the many recorded activities: only the tiles in view get loaded.
        /// Requires tippecanoe on PATH.
        /// </summary>
        public static void ExportPmTiles(GpxFile[] gpxFiles, string outputFilePath)
        {
            var inputFilePath = Path.Combine(Path.GetTempPath(), $"geoquest-tracks-{Guid.NewGuid()}.geojsonl");
            try
            {
                File.WriteAllLines(inputFilePath, BuildFeatureLines(gpxFiles, MaxPointGapMeters));
                RunTippecanoe(inputFilePath, outputFilePath);
            }
            finally
            {
                File.Delete(inputFilePath);
            }
        }

        /// <summary>
        /// Plain GeoJSON, for the handful of planned routes — too few to be worth tiling.
        /// Planned routes are never split: they come from a route planner, so they are
        /// continuous by construction and sampled far more sparsely than a recording
        /// (median ~27m, up to ~650m on straight stretches) — the gap splitting used for
        /// recorded tracks would shred them into fragments.
        /// </summary>
        public static void ExportGeoJson(GpxFile[] gpxFiles, string outputFilePath)
        {
            var features = string.Join(',', BuildFeatureLines(gpxFiles, double.PositiveInfinity));
            File.WriteAllText(outputFilePath, $"{{\"type\":\"FeatureCollection\",\"features\":[{features}]}}");
        }

        private static string[] BuildFeatureLines(GpxFile[] gpxFiles, double maxPointGapMeters)
        {
            var lines = new string?[gpxFiles.Length];
            Parallel.For(0, gpxFiles.Length, i =>
            {
                var segments = SplitAtGaps(gpxFiles[i].Points, maxPointGapMeters)
                    .Select(Simplify)
                    .Where(segment => segment.Length >= 2)
                    .ToArray();
                if (segments.Length == 0) return;

                lines[i] = BuildFeatureLine(segments, gpxFiles[i].Date);
            });

            return lines.OfType<string>().ToArray();
        }

        // the continuously recorded stretches of one activity, split wherever the recording
        // was paused; segments of a single point carry no line and are dropped
        private static IEnumerable<Coordinate[]> SplitAtGaps(Point[] points, double maxPointGapMeters)
        {
            var segmentStart = 0;
            for (var i = 1; i < points.Length; i++)
            {
                if (DistanceInMeters(points[i - 1].Coordinate, points[i].Coordinate) <= maxPointGapMeters) continue;

                if (i - segmentStart >= 2)
                    yield return points[segmentStart..i].Select(p => p.Coordinate).ToArray();
                segmentStart = i;
            }

            if (points.Length - segmentStart >= 2)
                yield return points[segmentStart..].Select(p => p.Coordinate).ToArray();
        }

        private static Coordinate[] Simplify(Coordinate[] segment)
        {
            var simplified = DouglasPeuckerSimplifier.Simplify(GeometryFactory.CreateLineString(segment), SimplifyToleranceDegrees);

            // 5 decimal places (~1m) is plenty for display and keeps the intermediate file small
            var rounded = new List<Coordinate>(simplified.Coordinates.Length);
            foreach (var coordinate in simplified.Coordinates)
            {
                var candidate = new Coordinate(Math.Round(coordinate.X, 5), Math.Round(coordinate.Y, 5));
                if (rounded.Count == 0 || !candidate.Equals2D(rounded[^1]))
                    rounded.Add(candidate);
            }

            return rounded.ToArray();
        }

        private static double DistanceInMeters(Coordinate a, Coordinate b)
        {
            const double earthRadiusMeters = 6_371_000;
            const double degreesToRadians = Math.PI / 180;

            var latitudeA = a.Y * degreesToRadians;
            var latitudeB = b.Y * degreesToRadians;
            var deltaLatitude = (b.Y - a.Y) * degreesToRadians;
            var deltaLongitude = (b.X - a.X) * degreesToRadians;

            var haversine = Math.Sin(deltaLatitude / 2) * Math.Sin(deltaLatitude / 2)
                            + Math.Cos(latitudeA) * Math.Cos(latitudeB) * Math.Sin(deltaLongitude / 2) * Math.Sin(deltaLongitude / 2);
            return 2 * earthRadiusMeters * Math.Asin(Math.Sqrt(haversine));
        }

        private static string BuildFeatureLine(Coordinate[][] segments, DateOnly date)
        {
            var builder = new StringBuilder(segments.Sum(segment => segment.Length) * 20);
            builder.Append($"{{\"type\":\"Feature\",\"properties\":{{\"date\":\"{date:yyyy-MM-dd}\"}},\"geometry\":{{\"type\":\"MultiLineString\",\"coordinates\":[");

            for (var s = 0; s < segments.Length; s++)
            {
                if (s > 0) builder.Append(',');
                builder.Append('[');

                var segment = segments[s];
                for (var c = 0; c < segment.Length; c++)
                {
                    if (c > 0) builder.Append(',');
                    builder.Append('[')
                        .Append(segment[c].X.ToString(CultureInfo.InvariantCulture))
                        .Append(',')
                        .Append(segment[c].Y.ToString(CultureInfo.InvariantCulture))
                        .Append(']');
                }

                builder.Append(']');
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
