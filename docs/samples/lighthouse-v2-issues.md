# Continuity issues — Fractal mvmrn3dt

- **[blocker] anchor_violation** event:ilse.falls_asleep
  #4 The slow star passes under the bluff with a sound like surf, and Ilse asks if it is hunting ↔ #5 Ilse goes to bed with the speaking tube uncorked and leaves the watch to Odile
  Bridge breaks its anchor contract on event:ilse.falls_asleep: ilse.falls_asleep already happened in “The slow star passes under the bluff with a sound like surf, and Ilse asks if it is hunting”.
- **[blocker] anchor_violation** ilse.awake
  #4 The slow star passes under the bluff with a sound like surf, and Ilse asks if it is hunting ↔ #5 Ilse goes to bed with the speaking tube uncorked and leaves the watch to Odile
  Bridge breaks its anchor contract on ilse.awake: expects awake, but “The slow star passes under the bluff with a sound like surf, and Ilse asks if it is hunting” left it asleep.
- **[warning] missing_transition** ledger.visibility_entry
  #5 Ilse goes to bed with the speaking tube uncorked and leaves the watch to Odile ↔ #7 The plotted mayday lies on bearing 241, and the speaking tube gives back only snoring
  “The plotted mayday lies on bearing 241, and the speaking tube gives back only snoring” needs ledger.visibility_entry different from what “Ilse goes to bed with the speaking tube uncorked and leaves the watch to Odile” left, and none of the 1 beat(s) between narrates the change: expects unidentified_light_brg_241, but “Ilse goes to bed with the speaking tube uncorked and leaves the watch to Odile” left it light_lost_brg_241_glow_persists.
- **[blocker] anchor_violation** charter_office_call.state
  #12 The Charter Office night clerk tells Odile there is no such thing as rescue at sea ↔ #13 Odile reads Article 9 down the line instead of hanging up, and the stairwell carries it upward
  Bridge breaks its anchor contract on charter_office_call.state: expects connected, but “The Charter Office night clerk tells Odile there is no such thing as rescue at sea” left it ended.
- **[blocker] anchor_violation** odile.location
  #12 The Charter Office night clerk tells Odile there is no such thing as rescue at sea ↔ #14 Ilse opens her door in her dressing gown and tells Odile to leave the line open
  Bridge breaks its anchor contract on odile.location: expects second_landing, but “The Charter Office night clerk tells Odile there is no such thing as rescue at sea” left it keeper_bedroom_second_landing.
- **[blocker] anchor_violation** ilse.awake
  #14 Ilse opens her door in her dressing gown and tells Odile to leave the line open ↔ #15 Ilse reads the old Notice to Mariners and waits for the frost
  Bridge breaks its anchor contract on ilse.awake: expects asleep, but “Ilse opens her door in her dressing gown and tells Odile to leave the line open” left it awake.
- **[blocker] anchor_violation** odile.location
  #15 Ilse reads the old Notice to Mariners and waits for the frost ↔ #16 The calm voice demands a charter station, and Ilse makes it ask twice
  Bridge breaks its anchor contract on odile.location: expects second_landing, but “Ilse reads the old Notice to Mariners and waits for the frost” left it lamp_room.
- **[blocker] anchor_violation** frost.state
  #15 Ilse reads the old Notice to Mariners and waits for the frost ↔ #16 The calm voice demands a charter station, and Ilse makes it ask twice
  Bridge breaks its anchor contract on frost.state: expects absent, but “Ilse reads the old Notice to Mariners and waits for the frost” left it forming.
- **[blocker] monotonic_violation** hover_reserve.remaining
  #16 The calm voice demands a charter station, and Ilse makes it ask twice ↔ #17 Four minutes of hover left, and Ilse answers Article 1
  hover_reserve.remaining stays at 4 min from “The calm voice demands a charter station, and Ilse makes it ask twice” to “Four minutes of hover left, and Ilse answers Article 1” while 15 min pass; a decreasing quantity cannot freeze unexplained.
- **[warning] missing_transition** odile.location
  #17 Four minutes of hover left, and Ilse answers Article 1 ↔ #20 A human voice breaks in on 2182 through the lamp-room repeater and asks whether it is water
  “A human voice breaks in on 2182 through the lamp-room repeater and asks whether it is water” needs odile.location different from what “Four minutes of hover left, and Ilse answers Article 1” left, and none of the 2 beat(s) between narrates the change: expects watch_room, but “Four minutes of hover left, and Ilse answers Article 1” left it watch_room_landing.
- **[blocker] anchor_violation** thalassas_promise.landing
  #19 Ilse Marrow turns the lamp down onto the frost ↔ #20 A human voice breaks in on 2182 through the lamp-room repeater and asks whether it is water
  Bridge breaks its anchor contract on thalassas_promise.landing: expects not_committed, but “Ilse Marrow turns the lamp down onto the frost” left it committed.
