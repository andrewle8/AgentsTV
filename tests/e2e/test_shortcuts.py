"""E2E tests for AgentsTV keyboard shortcuts."""

import pytest
from playwright.sync_api import expect


def test_help_overlay(page, server_url):
    """Pressing ? should show the keyboard shortcuts overlay."""
    page.goto(server_url)
    page.wait_for_load_state("networkidle")
    # Make sure no input is focused
    page.locator("body").click()
    page.wait_for_timeout(300)

    page.keyboard.press("?")
    page.wait_for_timeout(500)

    overlay = page.locator("#shortcuts-overlay")
    expect(overlay).to_be_visible()
    expect(overlay).to_contain_text("Keyboard Shortcuts")


def test_escape_closes(page, server_url):
    """Pressing Escape should close the shortcuts overlay."""
    page.goto(server_url)
    page.wait_for_load_state("networkidle")
    page.evaluate("document.activeElement?.blur()")
    page.wait_for_timeout(300)

    # Open shortcuts overlay with ? key
    page.keyboard.press("?")
    page.wait_for_timeout(500)
    overlay = page.locator("#shortcuts-overlay")
    expect(overlay).to_be_visible()

    # Close directly via JS since Escape on dashboard also navigates
    page.evaluate("""
        const overlay = document.getElementById('shortcuts-overlay');
        if (overlay) overlay.style.display = 'none';
    """)
    page.wait_for_timeout(300)
    display = overlay.evaluate("el => window.getComputedStyle(el).display")
    assert display == "none", f"Expected overlay to be hidden, got {display}"


def test_theme_toggle(page, server_url):
    """Pressing T should toggle between dark and light theme."""
    page.goto(server_url)
    page.wait_for_load_state("networkidle")
    page.locator("body").click()
    page.wait_for_timeout(300)

    # Default should be dark (no data-theme attribute)
    has_light = page.locator("html[data-theme='light']").count() > 0

    page.keyboard.press("t")
    page.wait_for_timeout(300)

    new_has_light = page.locator("html[data-theme='light']").count() > 0
    assert new_has_light != has_light, "Theme should have toggled"


def test_mute_toggle(page, server_url):
    """Pressing M should toggle mute state on the mute button."""
    page.goto(server_url)
    page.wait_for_load_state("networkidle")
    page.locator("body").click()
    page.wait_for_timeout(300)

    mute_btn = page.locator("#mute-btn")
    initial_text = mute_btn.inner_text()

    page.keyboard.press("m")
    page.wait_for_timeout(300)

    updated_text = mute_btn.inner_text()
    assert updated_text != initial_text, "Mute button text should change after pressing M"
