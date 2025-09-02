export const versionMock = `# Browser-compatible version module
import re
try:
    import structlog
    logger = structlog.get_logger()
except ImportError:
    class MinimalLogger:
        def info(self, *args, **kwargs): pass
        def error(self, *args, **kwargs): pass
        def warning(self, *args, **kwargs): pass
        def debug(self, *args, **kwargs): pass
    logger = MinimalLogger()

BASE_VERSION = '0.66.0'
DEFAULT_VERSION_SUFFIX = "local"
BUILD_VERSION_FILE_PATH = "./BUILD_VERSION"

# Valid formats: 1.2.3, 1.2.3-rc.1 and nightly-ab49c20f
BUILD_VERSION_REGEX = r"^(\\d+\\.\\d+\\.\\d+(-(rc|alpha|beta)\\.\\d+)?|nightly-[a-f0-9]{7,8})$"

__version__ = '1.0.0-browser'
MAJOR = 1
MINOR = 0
PATCH = 0

def _get_version():
    return __version__`;

