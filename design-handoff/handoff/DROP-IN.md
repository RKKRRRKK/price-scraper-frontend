# Breadboard icon set — drop-in guide

## 1. Icons → `public/icons/`
Copy everything from `handoff/icons/` into `public/icons/`, overwriting the old files.
All 21 original names are reused, so existing parts pick up the new art with **zero code changes**.

5 **new** files were added to fix parts that were borrowing the wrong icon:

| New file | Replaces (was using) |
|---|---|
| `led_lamp.svg` | LED used `led_display.svg` (the 7-seg panel) |
| `capacitor_ceramic.svg` | ceramic cap used `resistor.svg` |
| `capacitor_electrolytic.svg` | electrolytic cap used `resistor.svg` |
| `inductor.svg` | inductor used `resistor.svg` |
| `buzzer.svg` | buzzer used `heart_soundwave.svg` |

## 2. Point the affected parts at the new icons — `src/lib/breadboard/templates.js`

Change these `icon:` fields (search for each `kind`):

```diff
- led: comp({ kind: 'led', ... icon: 'led_display.svg', ... })
+ led: comp({ kind: 'led', ... icon: 'led_lamp.svg', ... })

- cap_104: comp({ ... icon: 'resistor.svg', ... })
+ cap_104: comp({ ... icon: 'capacitor_ceramic.svg', ... })

- ir_led_tsal6400: comp({ ... icon: 'led_display.svg', ... })   // optional: keep or → led_lamp.svg
+ ir_led_tsal6400: comp({ ... icon: 'led_lamp.svg', ... })

- inductor: comp({ ... icon: 'resistor.svg', ... })
+ inductor: comp({ ... icon: 'inductor.svg', ... })

- electrolytic_cap: comp({ ... icon: 'resistor.svg', ... })
+ electrolytic_cap: comp({ ... icon: 'capacitor_electrolytic.svg', ... })

- buzzer: comp({ ... icon: 'heart_soundwave.svg', ... })
+ buzzer: comp({ ... icon: 'buzzer.svg', ... })
```

In the **CONSUMABLES** list:

```diff
- { kind: 'ceramic_cap_kit',      ... icon: 'resistor.svg' },
+ { kind: 'ceramic_cap_kit',      ... icon: 'capacitor_ceramic.svg' },
- { kind: 'electrolytic_cap_kit', ... icon: 'resistor.svg' },
+ { kind: 'electrolytic_cap_kit', ... icon: 'capacitor_electrolytic.svg' },
- { kind: 'inductor_kit',         ... icon: 'resistor.svg' },
+ { kind: 'inductor_kit',         ... icon: 'inductor.svg' },
```

Add the new files to the part-creator picker (`ICON_FILES` array):

```diff
  export const ICON_FILES = [
    'circuit_board_general.svg', 'microchip.svg', 'resistor.svg', 'diode.svg', 'transistor.svg',
-   'led_display.svg', 'push_button.svg', 'dial_knob.svg', 'relay_switch.svg', 'motor_shaft.svg',
+   'led_lamp.svg', 'led_display.svg', 'capacitor_ceramic.svg', 'capacitor_electrolytic.svg',
+   'inductor.svg', 'buzzer.svg',
+   'push_button.svg', 'dial_knob.svg', 'relay_switch.svg', 'motor_shaft.svg',
    'environment_sensor.svg', 'light_sensor.svg', 'radar_distance_waves.svg', 'heart_soundwave.svg',
    'rfid_card.svg', 'wireless_antenna.svg', 'power_supply_plug.svg', 'aa_battery.svg',
    'breadboard.svg', 'electric_wire.svg', 'dupont_header.svg',
  ]
```

And (optional) the custom-part shape default:

```diff
  const DEFAULT_ICON_FOR_SHAPE = {
-   breakout: 'microchip.svg', to92: 'transistor.svg', resistor: 'resistor.svg',
-   led: 'led_display.svg', dip: 'microchip.svg', board: 'circuit_board_general.svg',
+   breakout: 'microchip.svg', to92: 'transistor.svg', resistor: 'resistor.svg',
+   led: 'led_lamp.svg', dip: 'microchip.svg', board: 'circuit_board_general.svg',
  }
```

## 3. On-canvas parts — `src/components/breadboard/ComponentSprite.vue`
`handoff/ComponentSprite.vue` replaces it. Same geometry, pin math, props and events — only
rendering changed, so it's a safe swap. Two things happened here:

**a) Polish on existing bodies** — domed LED lens + per-colour rim flange, TO-92 front seam,
red tactile button cap + gloss, breakout header strip, DIP/resistor/pot sheens, warmer
outline/leg colours.

**b) 7 NEW bespoke bodies** for inline discretes that were rendering as the *wrong* part.
Add the matching `body:` to each template in `templates.js`:

```diff
  electrolytic_cap: comp({ ... body: 'led' ... })
+ electrolytic_cap: comp({ ... body: 'electrolytic-cap' ... })   // was drawn as an LED

  inductor: comp({ ... body: 'resistor' ... })
+ inductor: comp({ ... body: 'inductor' ... })                   // was drawn as a resistor

  buzzer: comp({ ... body: 'led' ... })
+ buzzer: comp({ ... body: 'buzzer' ... })                       // was drawn as an LED

  dc_motor: comp({ ... body: 'led' ... })
+ dc_motor: comp({ ... body: 'dc-motor' ... })                  // was drawn as an LED

  reed_switch: comp({ ... body: 'resistor' ... })
+ reed_switch: comp({ ... body: 'reed' ... })                    // was drawn as a resistor

  trimpot: comp({ ... body: 'pot' ... })
+ trimpot: comp({ ... body: 'trimpot' ... })                     // was drawn as a pot

  seg7: dip({ ... })
+ seg7: dip({ ..., body: 'seg7' }),                              // was a blank DIP (keep straddle)
```

The new `body` ids the sprite now understands: `electrolytic-cap`, `buzzer`, `dc-motor`,
`inductor`, `reed`, `trimpot`, `seg7`. Anything not in that list still falls back to the
generic body it used before, so it's backward-compatible.

## 4. Generic vs bespoke — the decision
Everything else is **deliberately generic** and needs no per-part art:
- **DIP ICs** (555, logic gates, op-amps, ADCs, expanders…) → `dip` body, distinguished by part number.
- **Off-board modules** (sensors, comms, drivers, relays, servos, ultrasonic, displays…) render
  as the standalone **labeled card** — the pin names are what you wire to, so a picture would
  hurt. Those cards now stamp the part's **icon in the header** (via `<image :href="iconUrl(item.kind)">`),
  so they're recognisable at a glance without losing the wiring pads.
- resistor·LDR, LED·IR·RGB·NeoPixel, transistor·MOSFET·regulator·DS18B20, pot·encoder,
  button·DIP-switch all legitimately share their generic body.

If you later want full pictorial art for a few off-board modules (servo / relay / HC-SR04 / PIR),
that's a bigger change (a richer standalone renderer that keeps wire pads) — say the word.
