# Field climate engineering study — 2026-10-15

Profile **ARES-LAB/2**, Common tier. All coefficients and response curves are explicit game assumptions, not NASA/Mars agronomic validation or food-safety guidance. No RPC, wallet, token balances, orders or rewards. The old LAB/1 report remains historical; this command now runs LAB/2. One sol = 24.66 SIM h; growth requires 96 light-equivalent h adjusted by water, nutrients, health and temperature response.

| Scenario | SIM h | Crop | Health % | Greenhouse C | Target C | Development % | Stored kg | Quality % | Heater heat kWh | Unserved kWh |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Auto climate, target 20 C, mature cycle | 172.62 | mature | 100.00 | 20.00 | 20.00 | 100.00 | 0.00 | 0.00 | 40.49 | 0.00 |
| Climate disabled | 172.62 | dead | 0.00 | -7.06 | 20.00 | 44.24 | 0.00 | 0.00 | 0.00 | 0.00 |
| Auto climate, target 16 C | 172.62 | mature | 100.00 | 16.00 | 16.00 | 100.00 | 0.00 | 0.00 | 36.13 | 0.00 |
| Auto climate, target 26 C | 172.62 | tuber | 100.00 | 25.89 | 26.00 | 84.42 | 0.00 | 0.00 | 51.13 | 0.26 |
| Cold event, 2 sols | 172.62 | mature | 100.00 | 20.00 | 20.00 | 100.00 | 0.00 | 0.00 | 48.14 | 2.50 |
| Dust event, 2 sols | 172.62 | tuber | 95.04 | 20.00 | 20.00 | 77.21 | 0.00 | 0.00 | 44.70 | 52.86 |
| Food + new planting + dust, crop priority | 221.94 | seedling | 64.51 | 4.25 | 20.00 | 4.60 | 18.00 | 32.42 | 44.99 | 59.35 |
| Same, food-storage priority | 221.94 | seedling | 57.27 | 2.60 | 20.00 | 2.55 | 18.00 | 56.92 | 43.96 | 60.58 |
| Harvest, uncooled storage 100 h | 272.62 | empty | 100.00 | 20.00 | 20.00 | 0.00 | 0.00 | 0.00 | 78.28 | 0.00 |
| Process 5 kg, then uncooled storage 100 h | 284.62 | empty | 100.00 | 20.00 | 20.00 | 0.00 | 4.25 | 69.38 | 82.35 | 0.00 |

Priority comparison uses the same harvested lot + new planting + two-sol dust event, with only the declared allocation order changed. Water is always first; crop priority allocates climate/light before refrigeration, food priority allocates refrigeration before climate/light. No energy is created by switching modes.

Thermal accounting: final temperature = initial + (heater heat + lamp heat + signed envelope exchange - climate heat removal - evaporative loss) / effective thermal capacity. All terms arise from simulated weather, allocated electrical loads and consumed water; no temperature clamp manufactures heat. Material accounting still preserves water, nutrients and harvested food mass, including processing feed/losses and spoilage. POTATO cannot spoil and is not affected.
