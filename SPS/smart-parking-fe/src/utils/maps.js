export function buildGoogleMapsLinks(parking = {}) {
  // Accept multiple field name variants used across the app
  const name = String(parking.parking_name || parking.name || "").trim();
  const address = String(parking.parking_address || parking.address || "").trim();
  const lat = parking.lat ?? parking.latitude ?? parking.lat_deg ?? parking.lat_deg1;
  const lng = parking.lng ?? parking.longitude ?? parking.lon ?? parking.lng_deg ?? parking.lon_deg;

  let destinationText = "";
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    destinationText = `${Number(lat)},${Number(lng)}`;
  } else if (address) {
    destinationText = address;
  } else if (name) {
    destinationText = name;
  }

  const searchText = name || address || destinationText;

  if (!destinationText) {
    return { directionsUrl: "", mapUrl: "" };
  }

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationText)}`;
  const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchText)}`;

  return { directionsUrl, mapUrl };
}

export default buildGoogleMapsLinks;
