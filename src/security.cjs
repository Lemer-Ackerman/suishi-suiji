const fs = require("node:fs");
const { fileURLToPath } = require("node:url");
function isTrustedPage(frameUrl, expectedFile) {
  try {
    const url = new URL(frameUrl);
    if (url.protocol !== "file:" || url.hostname || url.search || url.hash)
      return false;
    // Windows installers may use an 8.3 alias (RUNNER~1) while Node resolves the
    // module through its long path. Compare real files instead of URL spelling.
    const actual = fs.realpathSync(fileURLToPath(url));
    const expected = fs.realpathSync(expectedFile);
    return process.platform === "win32"
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected;
  } catch {
    return false;
  }
}
module.exports = { isTrustedPage };
