const { checkGeoFence, checkCoordinateGeoFence } = require('../utils/geocheck');

describe('geofencing', () => {
  it.each([
    [null, 'KE', true],
    ['[]', 'US', true],
    ['["KE","UG"]', 'KE', true],
    ['["KE"]', 'US', false],
  ])('regions %p with buyer %s => %s', async (allowed_regions, location, allowed) => {
    await expect(checkGeoFence({ allowed_regions }, { location }, '127.0.0.1'))
      .resolves.toMatchObject({ allowed });
  });

  it.each([
    [0, 0, true, null],
    [0, 0.01, false, 'outside_delivery_area'],
    [null, null, false, 'coordinates_required'],
  ])('checks coordinate boundaries', (lat, lng, allowed, reason) => {
    const fence = { geo_fencing_enabled: 1, geo_fence_lat: 0,
      geo_fence_lng: 0, geo_fence_radius_km: 1 };
    expect(checkCoordinateGeoFence(fence, lat, lng)).toMatchObject({ allowed, reason });
  });
});
