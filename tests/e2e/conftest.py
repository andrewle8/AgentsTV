"""E2E test fixtures — starts a real agentstv server."""

import os
import signal
import socket
import subprocess
import sys
import time

import pytest
from playwright.sync_api import sync_playwright, Page, Browser


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server_port():
    return _find_free_port()


@pytest.fixture(scope="session")
def server_url(server_port):
    return f"http://127.0.0.1:{server_port}"


@pytest.fixture(scope="session", autouse=True)
def live_server(server_port):
    """Start agentstv server for the test session."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "agentstv",
         "--port", str(server_port),
         "--host", "127.0.0.1",
         "--no-browser",
         "--llm", "off"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Wait for server to be ready
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", server_port), timeout=1):
                break
        except OSError:
            time.sleep(0.5)
    else:
        proc.kill()
        raise RuntimeError("Server failed to start")

    yield proc

    # Teardown
    if sys.platform == "win32":
        proc.terminate()
    else:
        proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=3)


@pytest.fixture(scope="session")
def browser_instance():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(browser_instance, server_url):
    context = browser_instance.new_context()
    pg = context.new_page()
    pg.goto(server_url)
    pg.wait_for_load_state("networkidle")
    yield pg
    context.close()
