package clock

import "time"

type Clock interface{ Now() time.Time }
type System struct{}

// Now supplies wall-clock instants; callers convert to Unix milliseconds at persistence boundaries.
func (System) Now() time.Time { return time.Now() }
