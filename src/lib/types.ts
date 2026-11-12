/**
 * SmartRoute Guardian — shared data model.
 *
 * This file is the single source of truth for Firestore document shapes.
 * The Raspberry Pi gateway (device/) and firestore.rules follow the same
 * field names; see docs/ARCHITECTURE.md for the full contract.
 */
import type { Timestamp } from "firebase/firestore";

export type Role = "admin" | "driver" | "viewer" | "device" | "pending";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Actor {
  type: "device" | "driver" | "admin" | "system" | "simulator";
  id: string;
  name: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  /** Driver: the vehicle they operate. Device: the vehicle the reader is mounted in. */
  vehicleId?: string | null;
  deviceId?: string | null;
  licenseNo?: string;
  active?: boolean;
  demo?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type VehicleStatus = "idle" | "loading" | "en_route" | "returning" | "offline";

export interface VehicleLocation extends GeoPoint {
  speedKmh?: number;
  heading?: number;
  accuracyM?: number;
  source?: "gps_module" | "phone" | "simulator";
  updatedAt?: Timestamp;
}

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  type: "van" | "mini_truck" | "three_wheeler";
  capacity: number;
  driverId?: string | null;
  deviceId?: string | null;
  status: VehicleStatus;
  location?: VehicleLocation | null;
  activeRouteId?: string | null;
  /** EPCs currently detected inside the cargo area (published by the RFID gateway). */
  presentEpcs?: string[];
  presentCount?: number;
  lastScanAt?: Timestamp | null;
  readerOnline?: boolean;
  updatedAt?: Timestamp;
}

export type ParcelStatus =
  | "registered"
  | "assigned"
  | "loaded"
  | "in_transit"
  | "delivered"
  | "exception"
  | "returned";

export interface DeliveryProof {
  method: "rfid+driver" | "driver" | "admin";
  by: Actor;
  at: Timestamp;
  note?: string;
  location?: GeoPoint | null;
  receiverName?: string;
}

export interface Parcel {
  id: string;
  trackingId: string;
  /** 96-bit EPC Gen2 tag ID as 24 uppercase hex chars. */
  epc: string;
  recipientName: string;
  recipientPhone?: string;
  address: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  weightKg: number;
  size: "S" | "M" | "L";
  priority: "standard" | "express";
  status: ParcelStatus;
  /** Vehicle the parcel is ASSIGNED to (the manifest). */
  vehicleId?: string | null;
  routeId?: string | null;
  stopSeq?: number | null;
  /** Vehicle in which RFID currently DETECTS the parcel (null = not detected anywhere). */
  inVehicleId?: string | null;
  lastSeenAt?: Timestamp | null;
  loadedAt?: Timestamp | null;
  leftVehicleAt?: Timestamp | null;
  deliveredAt?: Timestamp | null;
  deliveryProof?: DeliveryProof | null;
  demo?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type RouteStatus = "planned" | "loading" | "in_progress" | "completed" | "cancelled";

export interface LoadVerification {
  expected: number;
  detected: number;
  missing: string[]; // parcel ids
  extra: string[]; // EPCs detected but not on this manifest
  passed: boolean;
  at: Timestamp;
  by: Actor;
  /** "rfid" = compared against the reader's live presence set; "manual" = driver ticked parcels off. */
  method?: "rfid" | "manual";
  /** How long the check took — the before/after comparison for the pilot report. */
  durationSec?: number | null;
}

export interface Hub extends GeoPoint {
  name: string;
}

export interface Route {
  id: string;
  code: string;
  date: string; // yyyy-MM-dd
  vehicleId: string;
  driverId?: string | null;
  status: RouteStatus;
  parcelIds: string[];
  stopCount: number;
  deliveredCount: number;
  hub: Hub;
  loadVerification?: LoadVerification | null;
  loadVerifiedAt?: Timestamp | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  demo?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type EventType =
  | "parcel_registered"
  | "parcel_assigned"
  | "parcel_loaded"
  | "parcel_unloaded"
  | "parcel_left_at_stop"
  | "parcel_delivered"
  | "route_created"
  | "route_started"
  | "load_verified"
  | "load_check_failed"
  | "route_completed"
  | "alert_raised"
  | "alert_acknowledged"
  | "alert_resolved"
  | "device_online"
  | "device_offline"
  | "note";

export interface AuditEvent {
  id: string;
  type: EventType;
  message: string;
  vehicleId?: string | null;
  parcelId?: string | null;
  trackingId?: string | null;
  routeId?: string | null;
  alertId?: string | null;
  epc?: string | null;
  actor: Actor;
  location?: GeoPoint | null;
  /** When the physical event happened (device clock). */
  deviceTime?: Timestamp | null;
  /** Server time the event reached the cloud. */
  createdAt?: Timestamp;
  demo?: boolean;
}

export type AlertType =
  | "missing_parcel"
  | "unauthorized_removal"
  | "wrong_vehicle"
  | "delivery_mismatch"
  | "unknown_tag"
  | "reader_offline";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  vehicleId: string;
  parcelId?: string | null;
  trackingId?: string | null;
  routeId?: string | null;
  epc?: string | null;
  location?: GeoPoint | null;
  /** When the condition physically occurred (e.g. the last RFID read before removal). */
  detectedAt?: Timestamp | null;
  createdAt?: Timestamp;
  acknowledgedAt?: Timestamp | null;
  acknowledgedBy?: Actor | null;
  resolvedAt?: Timestamp | null;
  resolvedBy?: Actor | null;
  resolution?: string | null;
  source: "device" | "simulator" | "driver" | "admin";
  demo?: boolean;
}

export interface DeviceStats {
  readsPerMin?: number;
  uniqueTags?: number;
  cpuTempC?: number;
  uptimeSec?: number;
  queueDepth?: number;
}

export interface DeviceConfig {
  txPowerDbm: number;
  absenceTimeoutSec: number;
  geofenceM: number;
  heartbeatSec: number;
}

export interface Device {
  id: string;
  vehicleId: string;
  model: string;
  firmware: string;
  lastHeartbeat?: Timestamp | null;
  stats?: DeviceStats;
  config?: DeviceConfig;
  ip?: string;
  notes?: string;
  updatedAt?: Timestamp;
}

export interface Message {
  id: string;
  /** One thread per driver: the driver's uid. */
  threadId: string;
  fromId: string;
  fromName: string;
  fromRole: Role;
  text: string;
  createdAt?: Timestamp;
}

export type TrialScenario = "static" | "loading" | "wrong_vehicle" | "missing_parcel" | "route";

export interface PilotTrial {
  id: string;
  name: string;
  date: string; // yyyy-MM-dd
  scenario: TrialScenario;
  site: string;
  parcelsTagged: number;
  parcelsDetected: number;
  alertsExpected: number;
  alertsRaised: number;
  falseAlerts: number;
  avgAlertLatencySec?: number | null;
  manualCheckSec?: number | null;
  rfidCheckSec?: number | null;
  notes?: string;
  /** Sample rows shipped with the demo dataset — never present these as real pilot results. */
  isSample: boolean;
  createdAt?: Timestamp;
}

export interface SystemSettings {
  absenceTimeoutSec: number;
  geofenceM: number;
  heartbeatSec: number;
  offlineAfterSec: number;
  targetStaticDetection: number;
  targetLoadingDetection: number;
  targetLatencySec: number;
  targetParcels: number;
  hub: Hub;
  orgName: string;
  /** Set while the demo dataset is loaded — dashboards show a "simulated data" banner. */
  demoDataLoadedAt?: Timestamp | null;
}

export interface PublicTimelineEntry {
  status: ParcelStatus | "out_for_delivery";
  label: string;
  at: Timestamp;
  rfidVerified?: boolean;
}

export interface PublicTracking {
  trackingId: string;
  status: ParcelStatus;
  area: string;
  city: string;
  recipientInitials: string;
  timeline: PublicTimelineEntry[];
  updatedAt?: Timestamp;
}
