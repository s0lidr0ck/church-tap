/**
 * Location service for IP geolocation and analytics
 */

/**
 * Get location information from IP address using ip-api.com
 * Free service with 45 requests per minute limit
 */
async function getLocationFromIP(ipAddress) {
  try {
    // Clean up IPv6-mapped IPv4 addresses
    if (ipAddress && ipAddress.startsWith('::ffff:')) {
      ipAddress = ipAddress.substring(7);
    }

    // Skip private/local IPs
    if (!ipAddress || 
        ipAddress === '127.0.0.1' || 
        ipAddress === '::1' || 
        ipAddress.startsWith('192.168.') || 
        ipAddress.startsWith('10.') || 
        ipAddress.startsWith('172.16.') ||
        ipAddress.startsWith('172.17.') ||
        ipAddress.startsWith('172.18.') ||
        ipAddress.startsWith('172.19.') ||
        ipAddress.startsWith('172.20.') ||
        ipAddress.startsWith('172.21.') ||
        ipAddress.startsWith('172.22.') ||
        ipAddress.startsWith('172.23.') ||
        ipAddress.startsWith('172.24.') ||
        ipAddress.startsWith('172.25.') ||
        ipAddress.startsWith('172.26.') ||
        ipAddress.startsWith('172.27.') ||
        ipAddress.startsWith('172.28.') ||
        ipAddress.startsWith('172.29.') ||
        ipAddress.startsWith('172.30.') ||
        ipAddress.startsWith('172.31.')) {
      console.log('📍 Skipping location lookup for private IP:', ipAddress);
      return {
        success: false,
        error: 'Private/local IP address',
        ip: ipAddress,
        city: null,
        region: null,
        country: null,
        latitude: null,
        longitude: null
      };
    }

    console.log('📍 Looking up location for IP:', ipAddress);
    
    // Use ip-api.com free service (45 requests/minute limit)
    const response = await fetch(`http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'fail') {
      console.log('❌ Location lookup failed:', data.message);
      return {
        success: false,
        error: data.message || 'Location lookup failed',
        ip: ipAddress,
        city: null,
        region: null,
        country: null,
        latitude: null,
        longitude: null
      };
    }
    
    console.log('✅ Location found:', data.city, data.regionName, data.country);
    
    return {
      success: true,
      ip: ipAddress,
      city: data.city || null,
      region: data.regionName || null,
      country: data.country || null,
      countryCode: data.countryCode || null,
      latitude: data.lat || null,
      longitude: data.lon || null,
      timezone: data.timezone || 'UTC',
      isp: data.isp || 'Unknown'
    };
  } catch (error) {
    console.error('❌ Location lookup error:', error.message);
    return {
      success: false,
      error: error.message,
      ip: ipAddress,
      city: null,
      region: null,
      country: null,
      latitude: null,
      longitude: null
    };
  }
}

/**
 * Batch lookup multiple IP addresses
 */
async function batchLocationLookup(ipAddresses) {
  try {
    const results = await Promise.all(
      ipAddresses.map(ip => getLocationFromIP(ip))
    );
    
    return {
      success: true,
      results: results
    };
  } catch (error) {
    console.error('❌ Batch location lookup failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update database with location information
 */
async function updateLocationInDatabase(ipAddress, locationData) {
  try {
    // This would typically update a database table with location information
    // For now, just log the action
    console.log('📊 Would update database with location data:', { ipAddress, locationData });
    
    return {
      success: true,
      message: 'Location data updated (placeholder)'
    };
  } catch (error) {
    console.error('❌ Failed to update location in database:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getLocationFromIP,
  batchLocationLookup,
  updateLocationInDatabase
};
