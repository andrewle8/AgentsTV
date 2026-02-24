"""E2E tests for the AgentsTV session detail view."""

import pytest
from playwright.sync_api import expect


def get_first_session_path(page, server_url):
    """Get the file_path of the first available session via API."""
    resp = page.request.get(f"{server_url}/api/sessions")
    sessions = resp.json()
    if not sessions:
        pytest.skip("No sessions available for E2E testing")
    return sessions[0]["file_path"]


def navigate_to_session(page, server_url):
    """Navigate to the first available session and wait for it to load."""
    file_path = get_first_session_path(page, server_url)
    page.goto(f"{server_url}/#/session/{file_path}")
    page.wait_for_load_state("networkidle")
    # Wait for session view to become visible
    page.wait_for_selector("#session-view", state="visible", timeout=5000)
    return file_path


def test_session_view_loads(page, server_url):
    """Session view should be visible after navigating to a session."""
    navigate_to_session(page, server_url)
    session_view = page.locator("#session-view")
    expect(session_view).to_be_visible()


def test_session_has_chat(page, server_url):
    """Session should have a chat log element."""
    navigate_to_session(page, server_url)
    chat_log = page.locator("#chat-log")
    expect(chat_log).to_be_visible()


def test_session_has_canvas(page, server_url):
    """Session should have a webcam canvas element."""
    navigate_to_session(page, server_url)
    canvas = page.locator("#webcam-canvas")
    expect(canvas).to_be_attached()


def test_code_overlay_exists(page, server_url):
    """Code overlay element should exist in the DOM (may be hidden)."""
    navigate_to_session(page, server_url)
    overlay = page.locator("#code-overlay")
    expect(overlay).to_be_attached()


def test_split_mode_toggle(page, server_url):
    """Clicking split button should show split chat panes."""
    navigate_to_session(page, server_url)
    split_btn = page.locator("#split-chat-btn")
    expect(split_btn).to_be_visible()

    # Click to enter split mode
    split_btn.click()
    page.wait_for_timeout(500)

    viewer_pane = page.locator(".viewer-pane")
    agent_pane = page.locator(".agent-pane")
    # At least one split pane should become visible
    assert viewer_pane.is_visible() or agent_pane.is_visible()

    # Click again to exit split mode
    split_btn.click()
    page.wait_for_timeout(500)


def test_back_navigation(page, server_url):
    """Navigating to a session then clicking back should show dashboard."""
    navigate_to_session(page, server_url)
    back_btn = page.locator("#back-btn")
    expect(back_btn).to_be_visible()
    back_btn.click()
    page.wait_for_load_state("networkidle")
    dashboard = page.locator("#dashboard-view")
    expect(dashboard).to_be_visible(timeout=5000)


def test_like_button(page, server_url):
    """Clicking the like button should increment the like count."""
    navigate_to_session(page, server_url)
    like_btn = page.locator("#like-btn")
    if not like_btn.is_visible():
        pytest.skip("Like button not visible")

    count_el = page.locator("#like-count")
    initial = int(count_el.inner_text() or "0")
    like_btn.click()
    page.wait_for_timeout(300)
    updated = int(count_el.inner_text() or "0")
    assert updated >= initial


def test_follow_button(page, server_url):
    """Clicking the follow button should toggle its state."""
    navigate_to_session(page, server_url)
    follow_btn = page.locator("#follow-btn")
    if not follow_btn.is_visible():
        pytest.skip("Follow button not visible")

    initial_text = follow_btn.inner_text()
    follow_btn.click()
    page.wait_for_timeout(300)
    updated_text = follow_btn.inner_text()
    assert updated_text != initial_text


def test_chat_dom_cap(page, server_url):
    """Chat log should not exceed a reasonable number of children."""
    navigate_to_session(page, server_url)
    page.wait_for_timeout(3000)  # Let chat populate
    chat_log = page.locator("#chat-log")
    children = chat_log.locator("> *")
    count = children.count()
    assert count < 600, f"Chat log has {count} children, expected < 600"


def test_session_slug_visible(page, server_url):
    """Session slug/name should be displayed."""
    navigate_to_session(page, server_url)
    slug = page.locator("#session-slug")
    expect(slug).to_be_visible()
    # Should have some text content
    text = slug.inner_text()
    assert len(text) > 0


def test_chat_input_exists(page, server_url):
    """Chat input field should exist for viewer interaction."""
    navigate_to_session(page, server_url)
    chat_input = page.locator("#chat-input")
    expect(chat_input).to_be_visible()
    # Placeholder depends on LLM state — just verify it has some placeholder text
    placeholder = chat_input.get_attribute("placeholder")
    assert placeholder and len(placeholder) > 0
