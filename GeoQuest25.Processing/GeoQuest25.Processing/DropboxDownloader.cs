using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;

namespace GeoQuest25.Processing
{
    /// <summary>
    /// Downloads a Dropbox folder as zip (files/download_zip) and extracts the contained
    /// files into a temp directory, flattened so the readers can consume it non-recursively.
    /// Authenticates via the OAuth refresh-token flow (short-lived access tokens are fetched
    /// on demand), so it works unattended in CI.
    /// </summary>
    public sealed class DropboxDownloader(string appKey, string appSecret, string refreshToken) : IDisposable
    {
        private readonly HttpClient _httpClient = new() { Timeout = Timeout.InfiniteTimeSpan };
        private string? _accessToken;

        /// <param name="dropboxFolderPath">Folder path within Dropbox, e.g. "/Apps/HealthFitExporter".</param>
        /// <param name="fileExtension">Optional filter, e.g. ".gpx"; null extracts every file.</param>
        private const int MaxDownloadAttempts = 3;

        public async Task<string> DownloadFolderAsync(string dropboxFolderPath, string? fileExtension = null)
        {
            for (var attempt = 1; ; attempt++)
            {
                var zipFilePath = Path.GetTempFileName();
                try
                {
                    await DownloadZipToFileAsync(dropboxFolderPath, zipFilePath);
                    return ExtractFolder(zipFilePath, dropboxFolderPath, fileExtension);
                }
                catch (InvalidDataException) when (attempt < MaxDownloadAttempts)
                {
                    // the downloaded file is not a complete zip. download_zip streams with
                    // chunked encoding, so a dropped connection ends the stream cleanly rather
                    // than throwing — the result is a truncated file. retry the whole download.
                    Console.WriteLine($"Downloaded zip for \"{dropboxFolderPath}\" was incomplete (attempt {attempt}/{MaxDownloadAttempts}); retrying ...");
                }
                finally
                {
                    File.Delete(zipFilePath);
                }
            }
        }

        private async Task DownloadZipToFileAsync(string dropboxFolderPath, string zipFilePath)
        {
            var accessToken = _accessToken ??= await GetAccessTokenAsync();

            using var request = new HttpRequestMessage(HttpMethod.Post, "https://content.dropboxapi.com/2/files/download_zip");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Headers.Add("Dropbox-API-Arg", JsonSerializer.Serialize(new { path = dropboxFolderPath }));

            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync();
                throw new ApplicationException($"Dropbox download_zip for \"{dropboxFolderPath}\" failed ({(int)response.StatusCode}): {error}");
            }

            // a zip download is binary; if dropbox answers 2xx with a json/text body (an error
            // delivered mid-stream, a gateway page, ...) surface it instead of later failing as
            // a cryptic "not a zip"
            var mediaType = response.Content.Headers.ContentType?.MediaType ?? "";
            if (mediaType.Contains("json", StringComparison.OrdinalIgnoreCase) || mediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
            {
                var body = await response.Content.ReadAsStringAsync();
                throw new ApplicationException($"Dropbox download_zip for \"{dropboxFolderPath}\" returned {mediaType} instead of a zip: {body}");
            }

            await CopyWithProgressAsync(response, zipFilePath);
        }

        private static string ExtractFolder(string zipFilePath, string dropboxFolderPath, string? fileExtension)
        {
            // ZipFile.OpenRead throws InvalidDataException if the file is not a complete zip
            using var archive = ZipFile.OpenRead(zipFilePath);

            var targetDirectory = Directory.CreateTempSubdirectory("geoquest-").FullName;
            var extractedCount = 0;
            foreach (var entry in archive.Entries)
            {
                if (entry.Name.Length == 0) continue; // directory entry
                if (fileExtension is not null && !entry.Name.EndsWith(fileExtension, StringComparison.OrdinalIgnoreCase)) continue;
                entry.ExtractToFile(Path.Combine(targetDirectory, entry.Name), overwrite: true);
                extractedCount++;
            }

            Console.WriteLine($"Downloaded \"{dropboxFolderPath}\" from Dropbox: {extractedCount} files");
            return targetDirectory;
        }

        private async Task CopyWithProgressAsync(HttpResponseMessage response, string zipFilePath)
        {
            await using var zipFileStream = File.Create(zipFilePath);
            await using var contentStream = await response.Content.ReadAsStreamAsync();

            var buffer = new byte[1 << 20];
            long totalBytes = 0;
            long nextLogAt = 512L * 1024 * 1024;
            int bytesRead;
            while ((bytesRead = await contentStream.ReadAsync(buffer)) > 0)
            {
                await zipFileStream.WriteAsync(buffer.AsMemory(0, bytesRead));
                totalBytes += bytesRead;
                if (totalBytes >= nextLogAt)
                {
                    Console.WriteLine($"  ... {totalBytes / (1024 * 1024)} MB downloaded");
                    nextLogAt += 512L * 1024 * 1024;
                }
            }
        }

        private async Task<string> GetAccessTokenAsync()
        {
            using var response = await _httpClient.PostAsync("https://api.dropboxapi.com/oauth2/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refreshToken,
                ["client_id"] = appKey,
                ["client_secret"] = appSecret,
            }));

            var payload = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                throw new ApplicationException($"Dropbox token refresh failed ({(int)response.StatusCode}): {payload}");

            using var document = JsonDocument.Parse(payload);
            return document.RootElement.GetProperty("access_token").GetString()
                   ?? throw new ApplicationException("Dropbox token response contained no access_token.");
        }

        public void Dispose() => _httpClient.Dispose();
    }
}
