/**
 * Utility functions for common operations
 */

/**
 * Formats a timestamp into a localized date string
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string
 */
export const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString();
};

/**
 * Formats a timestamp into a localized date and time string
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date and time string
 */
export const formatDateTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};
