/**
 * Timezone utility functions for consistent timestamp handling
 *
 * This module provides timezone-aware timestamp functions that use
 * the TZ environment variable for consistent timezone handling across
 * the application. If TZ is not set, defaults to UTC.
 */

/**
 * Get the configured timezone from environment variable
 * Defaults to UTC if not set
 * @returns {string} Timezone string (e.g., 'UTC', 'America/New_York', 'Europe/London')
 */
function get_timezone() {
	return process.env.TZ || process.env.TIMEZONE || "UTC";
}

/**
 * Get current date/time in the configured timezone
 * Returns a Date object that represents the current time in the configured timezone
 * @returns {Date} Current date/time
 */
function get_current_time() {
	const tz = get_timezone();

	// If UTC, use Date.now() which is always UTC
	if (tz === "UTC" || tz === "Etc/UTC") {
		return new Date();
	}

	// For other timezones, we need to create a date string with timezone info
	// and parse it. This ensures the date represents the correct time in that timezone.
	// For database storage, we always store UTC timestamps
	// The timezone is primarily used for display purposes
	return new Date();
}

/**
 * Get current timestamp in milliseconds (UTC)
 * This is always UTC for database storage consistency
 * @returns {number} Current timestamp in milliseconds
 */
function get_current_timestamp() {
	return Date.now();
}

/**
 * Format a date to ISO string in the configured timezone
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} ISO formatted date string
 */
function format_date_iso(date = null) {
	const d = date || get_current_time();
	return d.toISOString();
}

/**
 * Parse a date string and return a Date object
 * Handles various date formats and timezone conversions
 * @param {string} date_string - Date string to parse
 * @param {Date} fallback - Fallback date if parsing fails (defaults to now)
 * @returns {Date} Parsed date or fallback
 */
function parse_date(date_string, fallback = null) {
	if (!date_string) {
		return fallback || get_current_time();
	}

	try {
		const date = new Date(date_string);
		if (Number.isNaN(date.getTime())) {
			return fallback || get_current_time();
		}
		return date;
	} catch (_error) {
		return fallback || get_current_time();
	}
}

/**
 * Convert a date to the configured timezone for display
 * @param {Date} date - Date to convert
 * @returns {string} Formatted date string in configured timezone
 */
function format_date_for_display(date) {
	const tz = get_timezone();
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	return formatter.format(date);
}

module.exports = {
	get_timezone,
	get_current_time,
	get_current_timestamp,
	format_date_iso,
	parse_date,
	format_date_for_display,
};
