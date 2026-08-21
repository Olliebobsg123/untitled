# Networking fix

The packaged app now runs the Art-Net relay inside Electron's main process instead of spawning Electron as a Node child for the relay. This keeps the UDP socket attached to the Finder-launched GUI process, while QLab remains a child service.
