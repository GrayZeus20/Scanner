# Design Map

## Spacing Scale
- 8px (used 6 times)
- 10px (used 5 times)
- 6px (used 2 times)
- 48px (used 2 times)
- 20px, 12px

## Font Hierarchy
- Heading (h2): Plus Jakarta Sans, 20px, 700 weight, -0.4px letter-spacing
- Body: Plus Jakarta Sans, 14px, 400 weight, 21px line-height
- Button: 13.3px, 400 weight, 8px radius
- Button (Accent): 14px, 600 weight, 8px radius, 10px 22px padding

## Color Palette
- Background: #F1F5F9 (rgb(241, 245, 249))
- Surface / Cards: #FFFFFF (84.5% visual area)
- Text Primary: #0F172A (rgb(15, 23, 42))
- Text Secondary: #64748B (rgb(100, 116, 139))
- Accent (Interactive): #2563EB (rgb(37, 99, 235))

## Image Ratios
- [None detected in analyzer output]

## Component Tokens
- Border-radius: 8px (global scale)
- Focus-visible states enabled
- Reduced motion respected
- Transforms/opacity animated (0.15s cubic-bezier)

---

# Taste DNA

### Information Density over Visual Leisure
- **Trigger**: When designing the document viewer for constrained mobile views...
- **Decision**: Chose tight spacing and a small body font (14px) over whitespace-heavy layouts.
- **Reason**: Users need to see maximum scanned content and tool options without scrolling endlessly on small screens.
- **Evidence**: Small body font (14px), 21px line-height, dense spacing distribution (8px, 10px used frequently).

### Document-First Neutrality
- **Trigger**: When deciding how to frame the user's uploaded images...
- **Decision**: Chose a strictly neutral canvas (white backgrounds, minimal accent colors) over vibrant UI.
- **Reason**: Users require a predictable, distraction-free canvas so that any document type is legible and not visually overwhelmed by the app interface.
- **Evidence**: 84.5% white surface area, accent blue (37, 99, 235) used only for primary actions.

### Typography Restriction (Restraint)
- **Trigger**: When choosing how to handle diverse text elements (nav, buttons, content)...
- **Decision**: Chose a single font family (Plus Jakarta Sans) in multiple weights over a multi-font pairing.
- **Reason**: Restricting the type system to one family creates immediate visual cohesion and reduces user cognitive load.
- **Evidence**: 38 out of 49 font instances (77%) are Plus Jakarta Sans.

### Layout Directness
- **Trigger**: When deciding how to organize the content panels...
- **Decision**: Chose a cardless, direct flow over secondary containers (cards).
- **Reason**: Removing container boundaries minimizes visual noise and keeps focus strictly on the document processing tools.
- **Evidence**: 0 cards detected, layout flows directly on the page background.
