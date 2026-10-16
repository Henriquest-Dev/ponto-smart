"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";

/**
 * Mapa OpenStreetMap com o perímetro (círculo) e a margem de tolerância (tracejado).
 * Em modo editável, um toque no mapa ou arrastar o ponto central define o centro.
 * Pode mostrar também a posição actual com o erro do GPS. Carregado apenas no cliente.
 */
export function GeofenceMap({
  lat,
  lng,
  radius,
  tolerance = 0,
  me,
  editable,
  onPick,
  className,
}: {
  lat: number;
  lng: number;
  radius: number;
  /** Metros além do raio que ainda contam como dentro. */
  tolerance?: number;
  /** Posição actual do dispositivo (com precisão em metros). */
  me?: { lat: number; lng: number; accuracy: number } | null;
  editable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const circle = useRef<Circle | null>(null);
  const margin = useRef<Circle | null>(null);
  const dot = useRef<Marker | null>(null);
  const mine = useRef<Circle | null>(null);
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
      margin.current = L.circle([lat, lng], { radius: radius + tolerance, color: "#673fec", weight: 1.5, dashArray: "5 6", fill: false, opacity: tolerance > 0 ? 0.8 : 0 }).addTo(m);
      circle.current = L.circle([lat, lng], { radius, color: "#673fec", weight: 2, fillColor: "#673fec", fillOpacity: 0.12 }).addTo(m);
      mine.current = L.circle([0, 0], { radius: 1, color: "#0e7a4f", weight: 1.5, fillColor: "#0e7a4f", opacity: 0, fillOpacity: 0 }).addTo(m);
      const icon = L.divIcon({
        className: "",
        html: `<span style="display:block;width:${editable ? 22 : 12}px;height:${editable ? 22 : 12}px;border-radius:999px;background:#673fec;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
        iconSize: editable ? [22, 22] : [12, 12],
        iconAnchor: editable ? [11, 11] : [6, 6],
      });
      dot.current = L.marker([lat, lng], { icon, draggable: !!editable, keyboard: false, title: editable ? "Arraste para mudar o centro" : undefined }).addTo(m);
      if (editable) {
        m.on("click", (e) => pick.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
        dot.current.on("dragend", () => {
          const p = dot.current?.getLatLng();
          if (p) pick.current?.(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        });
      }
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
    if (!map.current || !circle.current || !dot.current || !margin.current) return;
    circle.current.setLatLng([lat, lng]).setRadius(radius);
    margin.current.setLatLng([lat, lng]).setRadius(radius + tolerance).setStyle({ opacity: tolerance > 0 ? 0.8 : 0 });
    dot.current.setLatLng([lat, lng]);
    map.current.panTo([lat, lng]);
  }, [lat, lng, radius, tolerance]);

  useEffect(() => {
    if (!map.current || !mine.current) return;
    if (!me) return void mine.current.setStyle({ opacity: 0, fillOpacity: 0 });
    mine.current.setLatLng([me.lat, me.lng]).setRadius(Math.max(3, me.accuracy)).setStyle({ opacity: 0.9, fillOpacity: 0.15 });
  }, [me]);

  return <div ref={el} className={className ?? "z-0 h-56 w-full overflow-hidden rounded-lg border border-border"} role="img" aria-label="Mapa do perímetro de marcação" />;
}
