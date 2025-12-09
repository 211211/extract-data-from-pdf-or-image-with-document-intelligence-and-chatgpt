#!/usr/bin/env python3
"""
MarkItDown Converter Script

This script provides a CLI wrapper around Microsoft's official MarkItDown library
for converting various document formats to Markdown.

Usage:
    python markitdown_converter.py <file_path> [--output <output_path>] [--json]

    # Convert file and print markdown to stdout
    python markitdown_converter.py document.pdf

    # Convert and save to file
    python markitdown_converter.py document.pdf --output result.md

    # Output as JSON (for programmatic use)
    python markitdown_converter.py document.pdf --json

Supported formats:
    - PDF (.pdf)
    - Microsoft Word (.docx)
    - Microsoft Excel (.xlsx)
    - Microsoft PowerPoint (.pptx)
    - Images (.jpg, .jpeg, .png, .gif, .bmp, .tiff)
    - HTML (.html, .htm)
    - Text (.txt, .csv, .xml, .json)
    - And more...

Requirements:
    pip install markitdown
"""

import argparse
import json
import sys
import os
from pathlib import Path
from typing import Optional


def check_markitdown_installed() -> bool:
    """Check if markitdown is installed."""
    try:
        from markitdown import MarkItDown
        return True
    except ImportError:
        return False


def convert_file(
    file_path: str,
    enable_plugins: bool = False,
) -> dict:
    """
    Convert a file to markdown using MarkItDown.

    Args:
        file_path: Path to the file to convert
        enable_plugins: Whether to enable MarkItDown plugins

    Returns:
        Dictionary with conversion result
    """
    from markitdown import MarkItDown

    # Validate file exists
    if not os.path.exists(file_path):
        return {
            "success": False,
            "error": f"File not found: {file_path}",
            "markdown": None,
            "file_path": file_path,
        }

    try:
        # Initialize MarkItDown
        md = MarkItDown(enable_plugins=enable_plugins)

        # Convert the file
        result = md.convert(file_path)

        return {
            "success": True,
            "error": None,
            "markdown": result.text_content,
            "file_path": file_path,
            "file_name": os.path.basename(file_path),
            "file_extension": Path(file_path).suffix.lower(),
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "markdown": None,
            "file_path": file_path,
        }


def convert_bytes(
    content: bytes,
    file_extension: str,
    enable_plugins: bool = False,
) -> dict:
    """
    Convert bytes content to markdown using MarkItDown.

    Args:
        content: File content as bytes
        file_extension: File extension (e.g., '.pdf', '.docx')
        enable_plugins: Whether to enable MarkItDown plugins

    Returns:
        Dictionary with conversion result
    """
    import tempfile
    from markitdown import MarkItDown

    # Ensure extension starts with dot
    if not file_extension.startswith('.'):
        file_extension = '.' + file_extension

    try:
        # Write to temporary file
        with tempfile.NamedTemporaryFile(suffix=file_extension, delete=False) as f:
            f.write(content)
            temp_path = f.name

        try:
            # Initialize MarkItDown
            md = MarkItDown(enable_plugins=enable_plugins)

            # Convert the file
            result = md.convert(temp_path)

            return {
                "success": True,
                "error": None,
                "markdown": result.text_content,
                "file_extension": file_extension,
            }
        finally:
            # Clean up temp file
            os.unlink(temp_path)

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "markdown": None,
            "file_extension": file_extension,
        }


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Convert documents to Markdown using Microsoft MarkItDown",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        "file_path",
        nargs="?",  # Make file_path optional
        help="Path to the file to convert"
    )

    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: print to stdout)"
    )

    parser.add_argument(
        "--json", "-j",
        action="store_true",
        help="Output result as JSON"
    )

    parser.add_argument(
        "--enable-plugins",
        action="store_true",
        help="Enable MarkItDown plugins"
    )

    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if markitdown is installed and exit"
    )

    args = parser.parse_args()

    # Check installation
    if args.check:
        if check_markitdown_installed():
            print(json.dumps({"installed": True}))
            sys.exit(0)
        else:
            print(json.dumps({"installed": False, "error": "markitdown not installed. Run: pip install markitdown"}))
            sys.exit(1)

    # Validate file_path is provided for conversion
    if not args.file_path:
        parser.error("file_path is required for conversion (use --check to verify installation)")

    # Verify markitdown is installed
    if not check_markitdown_installed():
        error_result = {
            "success": False,
            "error": "markitdown not installed. Run: pip install markitdown",
            "markdown": None,
        }
        if args.json:
            print(json.dumps(error_result))
        else:
            print(f"Error: {error_result['error']}", file=sys.stderr)
        sys.exit(1)

    # Convert the file
    result = convert_file(args.file_path, enable_plugins=args.enable_plugins)

    # Handle output
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif result["success"]:
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(result["markdown"])
            print(f"Converted successfully: {args.output}")
        else:
            print(result["markdown"])
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
