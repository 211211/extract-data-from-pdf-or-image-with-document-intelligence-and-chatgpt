#!/bin/bash
# Setup Python virtual environment for MarkItDown

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/.venv"

echo "Setting up Python virtual environment..."
echo "Project root: $PROJECT_ROOT"
echo "Virtual env: $VENV_DIR"

# Detect Python command
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3.8+"
    exit 1
fi

echo "Using Python: $PYTHON_CMD ($($PYTHON_CMD --version))"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"
else
    echo "Virtual environment already exists"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "Installing requirements..."
pip install -r "$PROJECT_ROOT/requirements.txt"

# Verify installation
echo ""
echo "Verifying MarkItDown installation..."
python -c "from markitdown import MarkItDown; print('MarkItDown installed successfully!')"

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
echo "Virtual environment: $VENV_DIR"
echo "Python path: $VENV_DIR/bin/python"
echo ""
echo "To activate manually:"
echo "  source $VENV_DIR/bin/activate"
echo "=========================================="
