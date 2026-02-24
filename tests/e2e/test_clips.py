"""E2E tests for AgentsTV clip recording functionality."""

import pytest
from playwright.sync_api import expect


def get_first_session_path(page, server_url):
    """Get the file_path of the first available session via API."""
    resp = page.request.get(f"{server_url}/api/sessions")
    sessions = resp.json()
    if not sessions:
        pytest.skip("No sessions available for E2E testing")
    return sessions[0]["file_path"]


def test_record_button_visible(page, server_url):
    """Record button should be visible in the session view."""
    file_path = get_first_session_path(page, server_url)
    page.goto(f"{server_url}/#/session/{file_path}")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#session-view", state="visible", timeout=5000)

    record_btn = page.locator("#record-btn")
    expect(record_btn).to_be_visible()


def test_toggle_recording(page, server_url):
    """Clicking the record button should toggle recording state."""
    file_path = get_first_session_path(page, server_url)
    page.goto(f"{server_url}/#/session/{file_path}")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#session-view", state="visible", timeout=5000)

    record_btn = page.locator("#record-btn")
    expect(record_btn).to_be_visible()

    had_active = record_btn.evaluate("el => el.classList.contains('recording')")

    record_btn.click()
    page.wait_for_timeout(500)

    has_active = record_btn.evaluate("el => el.classList.contains('recording')")
    assert has_active != had_active, "Recording state should toggle on click"

    # Click again to stop recording (clean up)
    record_btn.click()
    page.wait_for_timeout(300)
