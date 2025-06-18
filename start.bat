@echo off
echo Starting Smart Road System...

rem Start the Python detection API service
echo Starting Python detection API...
cd ai
start cmd /k python object_detection_api.py
cd ..

rem Wait a moment for the Python service to initialize
echo Waiting for API to initialize...
timeout /t 2 /nobreak

rem Start the Node.js server
echo Starting Node.js server...
node index.js

echo Done.