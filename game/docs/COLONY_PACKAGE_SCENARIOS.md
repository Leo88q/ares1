# Colony ruleset v3 — approved package scenarios

Run: `cd game && yarn simulate:colony-rules`. The simulation runs the same backend engine and grant resolver for Starter and all seven expansion combinations over 30/90/180 days.

**Not an offer, live economy forecast or mainnet test.** Resources are server-side game values. No payment, token yield, stochastic events, maintenance/sinks, independent Field colonies or user behavior are modeled. The Field grant is reported as eligible linked-Field capacity; current game simulation has no production/action yield per linked Field. Lab cap is an entitlement limit; no Lab upgrade action exists yet, so simulated Lab production stays at its current level.

| Scenario | Field slots | Build / research queues | Capacity M/W/P/S | Resources at 30d (M/W/P/S) | 90d | 180d | First full storage M/W/P/S |
|---|---:|---:|---|---|---|---|---|
| Starter | 1 | 1 / 1 | ×1/1/1/1 | 1000/1000 · 1000/1000 · 1000/1000 · 500/500 | 1000/1000 · 1000/1000 · 1000/1000 · 500/500 | 1000/1000 · 1000/1000 · 1000/1000 · 500/500 | 165h (6.9d) / 59h (2.5d) / 38h (1.6d) / 253h (10.5d) |
| RESEARCH_WING | 1 | 1 / 2 | ×1/1/1/2 | 1000/1000 · 1000/1000 · 1000/1000 · 1000/1000 | 1000/1000 · 1000/1000 · 1000/1000 · 1000/1000 | 1000/1000 · 1000/1000 · 1000/1000 · 1000/1000 | 165h (6.9d) / 59h (2.5d) / 38h (1.6d) / 480h (20.0d) |
| FRONTIER_EXPANSION | 3 | 2 / 1 | ×2/2/2/2 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 194h (8.1d) / 100h (4.2d) / 56h (2.3d) / 480h (20.0d) |
| RESEARCH_WING + FRONTIER_EXPANSION | 3 | 2 / 2 | ×2/2/2/2 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 2000/2000 · 2000/2000 · 2000/2000 · 1000/1000 | 194h (8.1d) / 100h (4.2d) / 56h (2.3d) / 480h (20.0d) |
| INDUSTRIAL_NETWORK | 5 | 2 / 2 | ×4/4/4/4 | 4000/4000 · 4000/4000 · 4000/4000 · 1528/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 256h (10.7d) / 153h (6.4d) / 82h (3.4d) / 935h (39.0d) |
| RESEARCH_WING + INDUSTRIAL_NETWORK | 5 | 2 / 3 | ×4/4/4/4 | 4000/4000 · 4000/4000 · 4000/4000 · 1528/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 256h (10.7d) / 153h (6.4d) / 82h (3.4d) / 935h (39.0d) |
| FRONTIER_EXPANSION + INDUSTRIAL_NETWORK | 7 | 3 / 2 | ×4/4/4/4 | 4000/4000 · 4000/4000 · 4000/4000 · 1528/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 255h (10.6d) / 152h (6.3d) / 81h (3.4d) / 935h (39.0d) |
| RESEARCH_WING + FRONTIER_EXPANSION + INDUSTRIAL_NETWORK | 7 | 3 / 3 | ×4/4/4/4 | 4000/4000 · 4000/4000 · 4000/4000 · 1528/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 4000/4000 · 4000/4000 · 4000/4000 · 2000/2000 | 255h (10.6d) / 152h (6.3d) / 81h (3.4d) / 935h (39.0d) |

## Scheduled actions by scenario

### Starter

- h0: build solar_array
- h0: research resource_efficiency
- h1: build water_recycler
- h3: build metal_extractor
- h11: research hydrology
- h18: research metallurgy
- h26: research solar_grid
- h33: upgrade solar_array to 2
- h51: upgrade solar_array to 3
- h65: upgrade water_recycler to 2
- h93: upgrade water_recycler to 3
- h112: upgrade metal_extractor to 2
- h132: upgrade metal_extractor to 3

### RESEARCH_WING

- h0: build solar_array
- h0: research resource_efficiency
- h1: build water_recycler
- h3: build metal_extractor
- h11: research hydrology
- h18: research metallurgy
- h26: research solar_grid
- h33: upgrade solar_array to 2
- h51: upgrade solar_array to 3
- h65: upgrade water_recycler to 2
- h93: upgrade water_recycler to 3
- h112: upgrade metal_extractor to 2
- h132: upgrade metal_extractor to 3

### FRONTIER_EXPANSION

- h0: build solar_array
- h0: build water_recycler
- h0: research resource_efficiency
- h1: build metal_extractor
- h9: research hydrology
- h16: research metallurgy
- h26: research solar_grid
- h31: upgrade solar_array to 2
- h49: upgrade solar_array to 3
- h63: upgrade water_recycler to 2
- h91: upgrade water_recycler to 3
- h110: upgrade metal_extractor to 2
- h130: upgrade metal_extractor to 3

### RESEARCH_WING + FRONTIER_EXPANSION

- h0: build solar_array
- h0: build water_recycler
- h0: research resource_efficiency
- h1: build metal_extractor
- h9: research hydrology
- h16: research metallurgy
- h26: research solar_grid
- h31: upgrade solar_array to 2
- h49: upgrade solar_array to 3
- h63: upgrade water_recycler to 2
- h91: upgrade water_recycler to 3
- h110: upgrade metal_extractor to 2
- h130: upgrade metal_extractor to 3

### INDUSTRIAL_NETWORK

- h0: build solar_array
- h0: build water_recycler
- h0: research resource_efficiency
- h1: build metal_extractor
- h9: research hydrology
- h16: research metallurgy
- h26: research solar_grid
- h31: upgrade solar_array to 2
- h49: upgrade solar_array to 3
- h63: upgrade water_recycler to 2
- h91: upgrade water_recycler to 3
- h110: upgrade metal_extractor to 2
- h130: upgrade metal_extractor to 3

### RESEARCH_WING + INDUSTRIAL_NETWORK

- h0: build solar_array
- h0: build water_recycler
- h0: research resource_efficiency
- h1: build metal_extractor
- h9: research hydrology
- h16: research metallurgy
- h26: research solar_grid
- h31: upgrade solar_array to 2
- h49: upgrade solar_array to 3
- h63: upgrade water_recycler to 2
- h91: upgrade water_recycler to 3
- h110: upgrade metal_extractor to 2
- h130: upgrade metal_extractor to 3

### FRONTIER_EXPANSION + INDUSTRIAL_NETWORK

- h0: build solar_array
- h0: build water_recycler
- h0: build metal_extractor
- h0: research resource_efficiency
- h8: research hydrology
- h15: research metallurgy
- h26: upgrade solar_array to 2
- h30: research solar_grid
- h48: upgrade solar_array to 3
- h62: upgrade water_recycler to 2
- h90: upgrade water_recycler to 3
- h109: upgrade metal_extractor to 2
- h129: upgrade metal_extractor to 3

### RESEARCH_WING + FRONTIER_EXPANSION + INDUSTRIAL_NETWORK

- h0: build solar_array
- h0: build water_recycler
- h0: build metal_extractor
- h0: research resource_efficiency
- h8: research hydrology
- h15: research metallurgy
- h26: upgrade solar_array to 2
- h30: research solar_grid
- h48: upgrade solar_array to 3
- h62: upgrade water_recycler to 2
- h90: upgrade water_recycler to 3
- h109: upgrade metal_extractor to 2
- h129: upgrade metal_extractor to 3

## Interpretation

- Queue grants are enforced by the same action engine used by Colony service. Building/research costs and production remain server-calculated; queue slots only permit more concurrent jobs.
- Storage caps apply per resource: Research Wing doubles science storage; Frontier doubles all four; Industrial multiplies all four by four. Purchased storage is combined by the maximum applicable multiplier, not stacked multiplicatively.
- Fields are additive slots, Lab cap is max-of-owned grants. Neither increases resource production in this model. Implementing multiple linked Field accounts and a Lab-upgrade action requires their separate service/data-flow implementation and approved mechanics; no value is invented here.
- This is one deterministic greedy policy, not an optimizer. A resource reaching capacity means further production is discarded by the existing engine; it highlights the need to balance net production/sinks, not a case for punitive offline loss.
- Change `BUILD_ORDER` / `RESEARCH_ORDER` to test a different strategy. Horizons are declared in `HORIZONS`; the upper limit must remain within the engine five-year materialization bound.
