/* CloudFront Function (JavaScript runtime 2.0)
 * Adds security headers to the frontend responses.
 */
function handler(event) {
  var response = event.response;
  var headers = response.headers;

  // HTML must never be cached by the browser/CDN edge: a stale index.html points
  // at hashed JS/CSS chunks that a later deploy has already removed, which left
  // Brave on a blank page with a module-load error after an update. Hashed
  // assets keep the aggressive cache (their names change every build). We detect
  // HTML by content-type on the response.
  var contentType = headers['content-type'] && headers['content-type'].value;
  if (contentType && contentType.indexOf('text/html') !== -1) {
    headers['cache-control'] = { value: 'no-cache, no-store, must-revalidate' };
  }

  headers['strict-transport-security'] = {
    value: 'max-age=63072000; includeSubDomains; preload',
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'DENY' };
  headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
  headers['permissions-policy'] = {
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  headers['content-security-policy'] = {
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  };

  return response;
}
