"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Circle, Map as LeafletMap, CircleMarker } from "leaflet";

/**
 * Mapa OpenStreetMap com o perímetro (círculo). Em modo editável, um clique
 * define o centro. Carregado apenas no cliente.
 */
export function GeofenceMap({
  lat,
  lng,
  radius,
  editable,
  onPick,
  className,
}: {
  lat: number;
  lng: number;
  radius: number;
  editable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const circle = useRef<Circle | null>(null);
  const dot = useRef<CircleMarker | null>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: !!editable }).setView([lat, lng], 17);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      circle.current = L.circle([lat, lng], { radius, color: "#673fec", weight: 2, fillColor: "#673fec", fillOpacity: 0.12 }).addTo(m);
      dot.current = L.circleMarker([lat, lng], { radius: 5, color: "#fff", weight: 2, fillColor: "#673fec", fillOpacity: 1 }).addTo(m);
      if (editable) m.on("click", (e) => pick.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current || !circle.current || !dot.current) return;
    circle.current.setLatLng([lat, lng]).setRadius(radius);
    dot.current.setLatLng([lat, lng]);
    map.current.panTo([lat, lng]);
  }, [lat, lng, radius]);

  return <div ref={el} className={className ?? "z-0 h-56 w-full overflow-hidden rounded-lg border border-border"} role="img" aria-label="Mapa do perímetro de marcação" />;
}
