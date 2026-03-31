================================================================================
  PROJECT: 3D Wine Cellar
  START DATE: June 2025
  URL: https://cellar3d.vercel.app
================================================================================

INITIAL REFACTOR:

  Parametric Geometry
  Racks are now fully configurable by Rows, Columns, and Depth. Spacing, 
  lighting, and shelving wire-density adjust dynamically to fit dimensions.

SUBSEQUENT CHANGES:

  Multi-Cellar Architecture
  Added support for instantiating multiple independent cellar units within 
  the global coordinate system.

  Professional Aesthetic
  Stripped legacy game-like textures in favor of a high-fidelity, 
  minimalist "Lumon-grade" appearance.

  State Persistence
  Implemented LocalStorage synchronization to persist cellar configurations 
  across sessions.

  Smart Inheritance
  New cellar instances automatically deep-copy the configuration of the 
  preceding unit for seamless expansion.

================================================================================
Three men are sitting in a cell in the Gulag. The first says, "I was five 
minutes late to the vineyard, and they accused me of sabotaging the 
People's Economy."

The second says, "I was five minutes early to the vineyard, and they 
accused me of being a spy."

The third man sighs and says, "I arrived at the vineyard exactly on time, 
so they arrested me for owning a Western watch."
================================================================================
