import os
import uvicorn
from core.server import app, PORT 

host = os.environ.get("REFSEARCH_HOST", "127.0.0.1")
port = int(os.environ.get("REFSEARCH_PORT", str(PORT)))
uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)