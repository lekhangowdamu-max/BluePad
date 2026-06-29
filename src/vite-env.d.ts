/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface BluetoothRequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: BluetoothServiceUUID[] }>
  optionalServices?: BluetoothServiceUUID[]
  acceptAllDevices?: boolean
}

type BluetoothServiceUUID = string | number

interface BluetoothDevice {
  id: string
  name?: string
  gatt?: unknown
}

interface Bluetooth {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  bluetooth?: Bluetooth
}
