"""E2E tests for AgentsTV dark/light theme functionality."""

import pytest
from playwright.sync_api import expect


def test_dark_default(page):
    """By default, the page should be in dark theme (no data-theme='light')."""
    has_light = page.locator("html[data-theme='light']").count()
    assert has_light == 0, "Default theme should be dark"


def test_light_toggle(page):
    """Clicking the theme toggle button should switch to light theme."""
    theme_btn = page.locator("#theme-toggle-btn")
    expect(theme_btn).to_be_visible()

    theme_btn.click()
    page.wait_for_timeout(300)

    has_light = page.locator("html[data-theme='light']").count()
    assert has_light == 1, "Theme should be light after clicking toggle"

    # Click again to restore dark
    theme_btn.click()
    page.wait_for_timeout(300)
    has_light = page.locator("html[data-theme='light']").count()
    assert has_light == 0, "Theme should be dark after second click"


def test_theme_persistence(page, browser_instance, server_url):
    """Theme preference should persist across page reloads via localStorage."""
    theme_btn = page.locator("#theme-toggle-btn")
    theme_btn.click()
    page.wait_for_timeout(300)

    # Verify light theme is active
    has_light = page.locator("html[data-theme='light']").count()
    assert has_light == 1

    # Reload the page
    page.reload()
    page.wait_for_load_state("networkidle")

    # Theme should still be light after reload
    has_light = page.locator("html[data-theme='light']").count()
    assert has_light == 1, "Light theme should persist after reload"

    # Clean up: reset to dark
    theme_btn = page.locator("#theme-toggle-btn")
    theme_btn.click()
    page.wait_for_timeout(200)
