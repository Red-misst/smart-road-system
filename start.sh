#!/bin/bash

# Start the Python detection API service
echo "Starting Python detection API..."
cd ai
python object_detection_api.py &
python_pid=$!

echo "Python API started with PID: $python_pid"

# Wait a moment for the Python service to initialize
sleep 2

# Start the Node.js server
echo "Starting Node.js server..."
cd ..
node index.js

# Cleanup when Node.js server exits
trap "kill $python_pid; echo 'Stopping services...'" EXIT

# Wait for processes to complete
wait
