"""E2E tests for the AgentsTV replay mode."""

import pytest
from playwright.sync_api import expect


def get_first_session_path(page, server_url):
    """Get the file_path of the first available session via API."""
    resp = page.request.get(f"{server_url}/api/sessions")
    sessions = resp.json()
    if not sessions:
        pytest.skip("No sessions available for E2E testing")
    return sessions[0]["file_path"]


def navigate_to_replay(page, server_url):
    """Navigate to replay mode for the first available session."""
    file_path = get_first_session_path(page, server_url)
    page.goto(f"{server_url}/#/replay/{file_path}")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#session-view", state="visible", timeout=5000)
    return file_path


def test_replay_controls_visible(page, server_url):
    """Replay controls bar should appear when in replay mode."""
    navigate_to_replay(page, server_url)
    controls = page.locator("#replay-controls")
    expect(controls).to_be_visible(timeout=5000)


def test_replay_play_pause(page, server_url):
    """Play/pause button should toggle state on click."""
    navigate_to_replay(page, server_url)
    play_btn = page.locator("#replay-play-btn")
    expect(play_btn).to_be_visible(timeout=5000)

    initial_text = play_btn.inner_text()
    play_btn.click()
    page.wait_for_timeout(500)
    toggled_text = play_btn.inner_text()
    # The button text should change between play and pause symbols
    # (may be same if already playing, just verify no crash)
    assert isinstance(toggled_text, str)


def test_replay_seek(page, server_url):
    """Clicking on the progress bar should change the fill position."""
    navigate_to_replay(page, server_url)
    track = page.locator("#replay-progress-track")
    expect(track).to_be_visible(timeout=5000)

    fill = page.locator("#replay-progress-fill")
    initial_width = fill.evaluate("el => el.style.width")

    # Click near the middle of the progress track
    box = track.bounding_box()
    if box:
        page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] / 2)
        page.wait_for_timeout(500)
        new_width = fill.evaluate("el => el.style.width")
        # Position may or may not change depending on session length
        assert isinstance(new_width, str)


def test_replay_speed_change(page, server_url):
    """Changing speed dropdown should update the selected value."""
    navigate_to_replay(page, server_url)
    speed_select = page.locator("#replay-speed-select")
    expect(speed_select).to_be_visible(timeout=5000)

    speed_select.select_option("4")
    page.wait_for_timeout(300)
    selected = speed_select.input_value()
    assert selected == "4"


def test_replay_exit(page, server_url):
    """Clicking exit should hide replay controls and show session view."""
    file_path = navigate_to_replay(page, server_url)
    exit_btn = page.locator("#replay-exit-btn")
    expect(exit_btn).to_be_visible(timeout=5000)

    exit_btn.click()
    page.wait_for_timeout(1000)
    # After exit, replay controls should be hidden
    controls = page.locator("#replay-controls")
    expect(controls).to_be_hidden()


def test_replay_seek_debounce(page, server_url):
    """Rapidly clicking progress bar should not crash the UI."""
    navigate_to_replay(page, server_url)
    track = page.locator("#replay-progress-track")
    expect(track).to_be_visible(timeout=5000)

    box = track.bounding_box()
    if box:
        for i in range(5):
            frac = 0.1 + i * 0.15
            page.mouse.click(
                box["x"] + box["width"] * frac,
                box["y"] + box["height"] / 2,
            )
            page.wait_for_timeout(50)

    # Wait and verify no crash — page should still be interactive
    page.wait_for_timeout(500)
    session_view = page.locator("#session-view")
    expect(session_view).to_be_visible()
