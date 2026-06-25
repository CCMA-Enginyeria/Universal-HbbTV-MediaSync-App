---
name: Synchronous Architecture
colors:
  surface: '#10131b'
  surface-dim: '#10131b'
  surface-bright: '#363941'
  surface-container-lowest: '#0b0e15'
  surface-container-low: '#191b23'
  surface-container: '#1d1f27'
  surface-container-high: '#272a32'
  surface-container-highest: '#32353d'
  on-surface: '#e1e2ed'
  on-surface-variant: '#c2c6d7'
  inverse-surface: '#e1e2ed'
  inverse-on-surface: '#2d3039'
  outline: '#8c90a0'
  outline-variant: '#424754'
  surface-tint: '#afc6ff'
  primary: '#afc6ff'
  on-primary: '#002d6d'
  primary-container: '#528dff'
  on-primary-container: '#00275f'
  inverse-primary: '#0059c7'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#ffb68f'
  on-tertiary: '#542100'
  tertiary-container: '#e96c16'
  on-tertiary-container: '#4a1c00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d9e2ff'
  primary-fixed-dim: '#afc6ff'
  on-primary-fixed: '#001944'
  on-primary-fixed-variant: '#004299'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb68f'
  on-tertiary-fixed: '#331100'
  on-tertiary-fixed-variant: '#773200'
  background: '#10131b'
  on-background: '#e1e2ed'
  surface-variant: '#32353d'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

The design system is rooted in the concepts of precision, connectivity, and real-time synchronization. It evokes a professional, high-tech atmosphere that feels both dependable and cutting-edge. The visual narrative is defined by a "Deep Space" aesthetic—utilizing a dark, expansive foundation punctuated by vibrant, glowing data-driven elements.

The style is a blend of **Corporate Modern** and **Glassmorphism**. It maintains the structural integrity and legibility required for enterprise technology while incorporating translucent layers and atmospheric glows to signify the movement of data and the "synchronized" nature of the architecture. Surfaces are treated with subtle glass effects to create a sense of light passing through the interface, mirroring the speed of modern media syncing.

## Colors

The palette is anchored by a deep navy foundation, providing a high-contrast backdrop for vibrant digital accents. 

- **Primary & Secondary:** A high-energy gradient spanning from a bright tech-blue to a deep violet. This gradient is the "signal" of the system, used to represent active states, data flows, and brand highlights.
- **Backgrounds:** The primary background uses a deep #050A18. Layered surfaces (cards, sidebars) use slightly lighter navies to establish a hierarchy of information.
- **Typography:** Pure white is used for primary headings to ensure maximum impact, with desaturated blues used for secondary and tertiary text to maintain the "dark mode" comfort.

## Typography

This design system utilizes a tiered typography strategy to balance brand personality with technical clarity.

- **Headlines:** Uses **Plus Jakarta Sans** for a modern, approachable, and slightly geometric feel. Large display sizes should use tight letter spacing and bold weights to mimic the professional impact seen in the reference material.
- **Body:** **Inter** is the workhorse font, chosen for its exceptional legibility in data-heavy environments and its neutral, systematic character.
- **Technical/Labels:** **JetBrains Mono** is introduced for small labels, status indicators, and metadata. This reinforces the "high-tech" and "architecture" narrative of the brand.

## Layout & Spacing

The layout follows a **Fluid Grid** model with a disciplined 8px spatial system.

- **Desktop:** A 12-column grid with generous 40px - 64px horizontal padding (margins) to create a centered, cinematic focus. Gutters are fixed at 24px to ensure breathing room between technical components.
- **Mobile:** Transition to a 4-column grid with 16px margins. 
- **Density:** The system favors "comfortable" spacing for marketing and dashboard overviews, but allows for "compact" spacing within data tables or configuration panels where information density is critical.

## Elevation & Depth

Depth is established through **Tonal Layering** and **Glassmorphism** rather than traditional drop shadows.

- **Base Level:** The deep #050A18 background.
- **Surface Level:** Cards and panels use #0F172A with a subtle 1px border (#FFFFFF10).
- **Overlay Level:** Modals and tooltips utilize a backdrop-blur (12px) and a semi-transparent fill to create a "glass" effect, allowing the background colors to softly bleed through.
- **Luminance:** Active elements (like the primary button or a selected tab) use an outer "glow"—a low-opacity shadow that matches the primary blue or purple color—to simulate light emission from a screen or signal.

## Shapes

The shape language is "Soft-Tech." It avoids the playfulness of fully circular pills while shunning the harshness of sharp corners.

- **Containers:** Cards and primary containers use a 0.5rem (8px) radius.
- **Interactive Elements:** Buttons and input fields follow the same 8px radius to maintain a consistent silhouette.
- **Visual Rhythm:** Decorative elements or "sync" icons may use varying stroke weights but should always maintain the same rounded terminal caps to match the typography's softness.

## Components

- **Buttons:** Primary buttons use the Blue-to-Purple gradient fill with white text. Secondary buttons use a "ghost" style: a transparent fill with a 1px gradient border.
- **Inputs:** Dark fills (#0F172A) with a subtle 1px border. On focus, the border should transition to the primary blue with a soft outer glow.
- **Chips/Status:** Use the JetBrains Mono font. Success states use a teal glow; active sync states use the brand gradient.
- **Cards:** No heavy shadows. Use a 1px border (#FFFFFF10) and a subtle background tint change on hover to indicate interactivity.
- **Progress/Sync Indicators:** Use animated gradients to show movement. Lines should be thin and precise, mimicking the "frequency" visualization in the brand logo.
- **Lists:** High-contrast separators using #FFFFFF05 (very faint grey/white) to keep the UI clean and uncluttered.