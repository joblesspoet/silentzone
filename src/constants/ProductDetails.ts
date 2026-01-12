/**
 * ProductDetails.ts
 * 
 * This file contains structured data about the Silent Zone app.
 * It can be used to render "About" pages, "Product" sections in web apps, 
 * or marketing materials dynamically.
 */

export const PRODUCT_NAME = "Silent Zone";
export const PRODUCT_TAGLINE = "Smart, location-aware audio management.";

export const TECH_STACK = {
  framework: "React Native 0.83.1",
  language: "TypeScript",
  database: "Realm (Offline-first)",
  maps: "React Native Maps",
  background: "Notifee (Foreground & Trigger Services)",
  ui: ["Reanimated 4", "Vector Icons", "Linear Gradient", "SVG"],
};

export const APP_THEME = {
  primary: '#2563EB',
  secondary: '#10B981',
  accent: '#06B6D4',
  background: {
    light: '#F3F4F6',
    dark: '#101922',
  },
  surface: {
    light: '#FFFFFF',
    dark: '#1E2936',
  },
};

export const CORE_FEATURES = [
  {
    title: "Intelligent Geofencing",
    description: "Automatically mutes sound upon entering a predefined radius and restores it upon exit.",
    icon: "location-on",
  },
  {
    title: "Contextual Scheduling",
    description: "Combine location with time-based rules to ensure silencing only happens when it matters.",
    icon: "schedule",
  },
  {
    title: "Battery Optimized",
    description: "Adaptive location polling to minimize energy consumption while maintaining high accuracy.",
    icon: "battery-charging-full",
  },
  {
    title: "Privacy First",
    description: "Fully offline local storage ensures your data never leaves your device.",
    icon: "security",
  },
  {
    title: "Persistent Reliability",
    description: "Runs as a foreground service to prevent background termination by the OS.",
    icon: "check-circle",
  },
];

export const ADVANTAGES = [
  "Privacy-centric: Local data storage with no cloud requirement.",
  "Set-and-Forget: Seamless background transitions between sound modes.",
  "Customizable: Granular control over radius, categories, and time intervals.",
  "Robust: Designed to handle device restarts and unexpected app closures.",
];

export const PRODUCT_OVERVIEW = `
Silent Zone is a powerful utility designed to bridge the gap between physical location 
and digital notification management. It uses advanced geofencing and scheduling 
logic to ensure your device respects your environment automatically.
`.trim();
