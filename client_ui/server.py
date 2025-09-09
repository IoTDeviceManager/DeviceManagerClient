#!/usr/bin/env python3
import os
import sys
import logging
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = logging.getLogger(__name__)

class SPAHandler(SimpleHTTPRequestHandler):
    """HTTP handler that serves index.html for all non-file requests (SPA support)"""
    
    def __init__(self, *args, **kwargs):
        # Set the directory to serve files from
        self.directory = '/client_ui/dist'
        super().__init__(*args, directory=self.directory, **kwargs)
    
    def do_GET(self):
        """Handle GET requests with SPA fallback"""
        # Parse the URL
        parsed_path = urlparse(self.path)
        file_path = parsed_path.path.lstrip('/')
        
        # If no path, serve index.html
        if not file_path:
            file_path = 'index.html'
        
        # Full path to the requested file
        full_path = os.path.join(self.directory, file_path)
        
        # Check if it's a file request (has extension) and file exists
        if '.' in os.path.basename(file_path):
            if os.path.isfile(full_path):
                # File exists, serve it normally
                super().do_GET()
                return
            else:
                # File doesn't exist, return 404
                self.send_error(404, f"File not found: {file_path}")
                return
        
        # No extension (likely a route), check if directory exists
        if os.path.isdir(full_path):
            # Directory exists, serve normally (will look for index.html)
            super().do_GET()
            return
        
        # Not a file or directory - assume it's a React route
        # Serve index.html instead
        self.path = '/index.html'
        super().do_GET()
    
    def log_message(self, format, *args):
        """Custom logging"""
        logger.info(f"{self.address_string()} - {format % args}")

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 16000
    server_address = ('0.0.0.0', port)
    
    # Change to the directory we want to serve
    if os.path.exists('/client_ui/dist'):
        logger.info(f"Serving SPA from /client_ui/dist on port {port}")
    else:
        logger.error("/client_ui/dist directory not found!")
        sys.exit(1)
    
    httpd = HTTPServer(server_address, SPAHandler)
    logger.info(f"SPA server started at http://0.0.0.0:{port}")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped")
        httpd.shutdown()

if __name__ == '__main__':
    main()
