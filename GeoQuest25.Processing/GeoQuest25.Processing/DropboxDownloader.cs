using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace GeoQuest25.Processing
{
    /// <summary>
    /// Downloads all files of a Dropbox folder into a flat temp directory, so the readers can
    /// consume it non-recursively. Lists the folder (files/list_folder) and downloads each file
    /// individually (files/download) in parallel — deliberately NOT files/download_zip, which
    /// truncates its stream server-side once the zip crosses ~4 GB (32-bit zip limit), producing
    /// a corrupt archive. Individual downloads have no such aggregate size limit.
    /// Authenticates via the OAuth refresh-token flow (short-lived access tokens are fetched on
    /// demand), so it works unattended in CI.
    /// </summary>
    public sealed class DropboxDownloader(string appKey, string appSecret, string refreshToken) : IDisposable
    {
        private const int MaxParallelDownloads = 8;
        private const int MaxAttemptsPerFile = 4;

        private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromMinutes(5) };
        private string? _accessToken;

        /// <param name="dropboxFolderPath">Folder path within Dropbox, e.g. "/Apps/HealthFitExporter".</param>
        /// <param name="fileExtension">Optional filter, e.g. ".gpx"; null downloads every file.</param>
        public async Task<string> DownloadFolderAsync(string dropboxFolderPath, string? fileExtension = null)
        {
            var accessToken = _accessToken ??= await GetAccessTokenAsync();

            var filePaths = await ListFilePathsAsync(accessToken, dropboxFolderPath, fileExtension);
            Console.WriteLine($"Downloading {filePaths.Count} files from \"{dropboxFolderPath}\" ...");

            var targetDirectory = Directory.CreateTempSubdirectory("geoquest-").FullName;
            using var throttle = new SemaphoreSlim(MaxParallelDownloads);
            var downloaded = 0;

            await Task.WhenAll(filePaths.Select(async filePath =>
            {
                await throttle.WaitAsync();
                try
                {
                    await DownloadFileAsync(accessToken, filePath, targetDirectory);
                    var done = Interlocked.Increment(ref downloaded);
                    if (done % 500 == 0)
                        Console.WriteLine($"  ... {done}/{filePaths.Count} files downloaded");
                }
                finally
                {
                    throttle.Release();
                }
            }));

            Console.WriteLine($"Downloaded \"{dropboxFolderPath}\" from Dropbox: {filePaths.Count} files");
            return targetDirectory;
        }

        // full display paths (original case preserved — the readers filter file names case-sensitively)
        private async Task<List<string>> ListFilePathsAsync(string accessToken, string dropboxFolderPath, string? fileExtension)
        {
            var filePaths = new List<string>();
            var requestUri = "https://api.dropboxapi.com/2/files/list_folder";
            object body = new { path = dropboxFolderPath, recursive = false, limit = 2000 };

            while (true)
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
                {
                    Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                using var response = await _httpClient.SendAsync(request);
                var payload = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                    throw new ApplicationException($"Dropbox list_folder for \"{dropboxFolderPath}\" failed ({(int)response.StatusCode}): {payload}");

                using var document = JsonDocument.Parse(payload);
                var root = document.RootElement;
                foreach (var entry in root.GetProperty("entries").EnumerateArray())
                {
                    if (entry.GetProperty(".tag").GetString() != "file") continue;
                    var name = entry.GetProperty("name").GetString() ?? "";
                    if (fileExtension is not null && !name.EndsWith(fileExtension, StringComparison.OrdinalIgnoreCase)) continue;
                    filePaths.Add(entry.GetProperty("path_display").GetString()!);
                }

                if (!root.GetProperty("has_more").GetBoolean())
                    return filePaths;

                requestUri = "https://api.dropboxapi.com/2/files/list_folder/continue";
                body = new { cursor = root.GetProperty("cursor").GetString() };
            }
        }

        private async Task DownloadFileAsync(string accessToken, string dropboxFilePath, string targetDirectory)
        {
            var targetFilePath = Path.Combine(targetDirectory, Path.GetFileName(dropboxFilePath));

            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Post, "https://content.dropboxapi.com/2/files/download");
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                    // non-ascii chars in the path (e.g. a curly apostrophe) are \uXXXX-escaped by
                    // the default json encoder, which keeps the header value ascii-safe as required
                    request.Headers.Add("Dropbox-API-Arg", JsonSerializer.Serialize(new { path = dropboxFilePath }));

                    using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                    if (response.StatusCode is HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500)
                        throw new HttpRequestException($"transient Dropbox status {(int)response.StatusCode}");
                    if (!response.IsSuccessStatusCode)
                    {
                        var error = await response.Content.ReadAsStringAsync();
                        throw new ApplicationException($"Dropbox download for \"{dropboxFilePath}\" failed ({(int)response.StatusCode}): {error}");
                    }

                    await using var target = File.Create(targetFilePath);
                    await response.Content.CopyToAsync(target);
                    return;
                }
                catch (Exception ex) when (ex is HttpRequestException or IOException or TaskCanceledException && attempt < MaxAttemptsPerFile)
                {
                    await Task.Delay(TimeSpan.FromSeconds(attempt * 2));
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
