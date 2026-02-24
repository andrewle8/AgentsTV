"""E2E tests for the AgentsTV master control room view."""

import pytest
from playwright.sync_api import expect


def navigate_to_master(page, server_url):
    """Navigate to the master control room."""
    page.goto(f"{server_url}/#/master")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#session-view", state="visible", timeout=5000)


def test_master_loads(page, server_url):
    """Master control room should load and show the session view."""
    navigate_to_master(page, server_url)
    session_view = page.locator("#session-view")
    expect(session_view).to_be_visible()


def test_master_has_canvas(page, server_url):
    """Master view should have a webcam canvas for the control room animation."""
    navigate_to_master(page, server_url)
    canvas = page.locator("#webcam-canvas")
    expect(canvas).to_be_attached()


def test_master_has_chat(page, server_url):
    """Master view should have a chat log."""
    navigate_to_master(page, server_url)
    chat_log = page.locator("#chat-log")
    expect(chat_log).to_be_visible()


def test_master_has_back_button(page, server_url):
    """Master view should have a back button to return to browse."""
    navigate_to_master(page, server_url)
    back_btn = page.locator("#back-btn")
    expect(back_btn).to_be_visible()
    back_btn.click()
    page.wait_for_load_state("networkidle")
    dashboard = page.locator("#dashboard-view")
    expect(dashboard).to_be_visible(timeout=5000)
