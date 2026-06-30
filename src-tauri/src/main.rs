#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::{
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HostInfo {
    id: String,
    device_name: String,
    address: String,
    port: u16,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TransportMessage {
    from: String,
    from_name: String,
    payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DiscoveryMessage {
    kind: String,
    id: String,
    device_name: String,
    address: String,
    port: u16,
}

#[derive(Default)]
struct RuntimeState {
    device_id: String,
    device_name: String,
    role: String,
    current_host_id: Option<String>,
    known_hosts: Vec<HostInfo>,
    pending_messages: Arc<Mutex<Vec<TransportMessage>>>,
    client_streams: Arc<Mutex<Vec<TcpStream>>>,
    client_stream: Option<TcpStream>,
    host_port: Option<u16>,
}

impl RuntimeState {
    fn refresh_device_id(&mut self) {
        if self.device_id.is_empty() {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
            self.device_id = format!("{}-{}", process::id(), now.as_millis());
        }
    }
}

struct AppState(Mutex<RuntimeState>);

fn generate_device_id() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}-{}", process::id(), now.as_millis())
}

fn push_message(state: &Arc<Mutex<Vec<TransportMessage>>>, message: TransportMessage) {
    state.lock().unwrap().push(message);
}

fn broadcast_message(streams: &Arc<Mutex<Vec<TcpStream>>>, line: &str) -> bool {
    let mut guard = streams.lock().unwrap();
    let mut dead_indexes = Vec::new();

    for (index, stream) in guard.iter_mut().enumerate() {
        if stream.write_all(format!("{line}\n").as_bytes()).is_err() {
            dead_indexes.push(index);
        }
    }

    for index in dead_indexes.into_iter().rev() {
        guard.remove(index);
    }

    !guard.is_empty()
}

#[tauri::command]
fn get_device_identity(state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();
    serde_json::json!({
        "deviceId": runtime.device_id,
        "deviceName": runtime.device_name,
        "role": runtime.role,
    })
}

#[tauri::command]
fn set_device_name(name: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();
    runtime.device_name = if name.trim().is_empty() {
        "BluePad Device".to_string()
    } else {
        name.trim().to_string()
    };
    serde_json::json!({"deviceName": runtime.device_name})
}

#[tauri::command]
fn start_host(state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();
    runtime.role = "host".to_string();
    runtime.current_host_id = None;

    let listener = TcpListener::bind(("0.0.0.0", 0)).expect("host listener should start");
    let port = listener.local_addr().unwrap().port();
    runtime.host_port = Some(port);

    let pending_messages = runtime.pending_messages.clone();
    let client_streams = runtime.client_streams.clone();
    let device_id = runtime.device_id.clone();
    let device_name = runtime.device_name.clone();

    thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                let pending = pending_messages.clone();
                let streams = client_streams.clone();
                let device_id = device_id.clone();
                let device_name = device_name.clone();

                streams.lock().unwrap().push(stream.try_clone().unwrap());
                push_message(
                    &pending,
                    TransportMessage {
                        from: device_id.clone(),
                        from_name: device_name.clone(),
                        payload: serde_json::json!({"type": "host-status", "status": "client-connected"}),
                    },
                );

                thread::spawn(move || {
                    let mut reader = BufReader::new(stream);
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 {
                            break;
                        }
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }

                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(line) {
                            let inner_payload = if payload.get("payload").is_some() {
                                payload["payload"].clone()
                            } else {
                                payload.clone()
                            };
                            let message = TransportMessage {
                                from: payload["deviceId"].as_str().unwrap_or("peer").to_string(),
                                from_name: payload["deviceName"].as_str().unwrap_or("Peer").to_string(),
                                payload: inner_payload,
                            };
                            push_message(&pending, message.clone());
                            let _ = broadcast_message(&streams, &serde_json::to_string(&message).unwrap());
                        }
                    }
                });
            }
        }
    });

    let pending_messages = runtime.pending_messages.clone();
    let device_id = runtime.device_id.clone();
    let device_name = runtime.device_name.clone();
    thread::spawn(move || {
        let socket = UdpSocket::bind(("0.0.0.0", 50050)).expect("announce socket should start");
        socket.set_broadcast(true).expect("broadcast should be enabled");
        let announcement = serde_json::to_string(&DiscoveryMessage {
            kind: "host-announcement".to_string(),
            id: device_id,
            device_name,
            address: "127.0.0.1".to_string(),
            port,
        })
        .unwrap();
        loop {
            let _ = socket.send_to(announcement.as_bytes(), ("255.255.255.255", 50050));
            thread::sleep(Duration::from_secs(2));
        }
    });

    serde_json::json!({"status": "host-running", "port": port})
}

#[tauri::command]
fn scan_for_hosts(state: State<'_, AppState>) -> Vec<HostInfo> {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();
    runtime.role = "client".to_string();
    runtime.known_hosts.clear();

    let socket = UdpSocket::bind(("0.0.0.0", 0)).expect("discovery socket should start");
    socket.set_read_timeout(Some(Duration::from_millis(1200))).unwrap();
    socket.set_broadcast(true).unwrap();
    let probe = serde_json::to_string(&DiscoveryMessage {
        kind: "host-probe".to_string(),
        id: runtime.device_id.clone(),
        device_name: runtime.device_name.clone(),
        address: "127.0.0.1".to_string(),
        port: runtime.host_port.unwrap_or(0),
    })
    .unwrap();
    let _ = socket.send_to(probe.as_bytes(), ("255.255.255.255", 50050));

    let mut buffer = [0u8; 2048];
    while let Ok((size, _)) = socket.recv_from(&mut buffer) {
        if let Ok(message) = serde_json::from_slice::<DiscoveryMessage>(&buffer[..size]) {
            if message.kind == "host-announcement" {
                runtime.known_hosts.push(HostInfo {
                    id: message.id,
                    device_name: message.device_name,
                    address: message.address,
                    port: message.port,
                    status: "Online".to_string(),
                });
            }
        }
    }

    runtime.known_hosts.clone()
}

#[tauri::command]
fn connect_to_host(host_id: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();
    runtime.role = "client".to_string();

    let host = runtime.known_hosts.iter().find(|item| item.id == host_id).cloned();
    let Some(host) = host else {
        return serde_json::json!({"connected": false, "error": "Host not found"});
    };

    let address = format!("{}:{}", host.address, host.port);
    if let Ok(mut stream) = TcpStream::connect(&address) {
        let connect_message = serde_json::json!({
            "type": "join",
            "deviceId": runtime.device_id,
            "deviceName": runtime.device_name,
            "hostId": host.id,
        });
        let _ = stream.write_all(format!("{}\n", connect_message).as_bytes());

        let pending_messages = runtime.pending_messages.clone();
        let device_id = runtime.device_id.clone();
        let device_name = runtime.device_name.clone();
        runtime.client_stream = Some(stream.try_clone().unwrap());
        runtime.current_host_id = Some(host.id.clone());

        thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(line) {
                    push_message(
                        &pending_messages,
                        TransportMessage {
                            from: payload["from"].as_str().unwrap_or(&device_id).to_string(),
                            from_name: payload["fromName"].as_str().unwrap_or(&device_name).to_string(),
                            payload,
                        },
                    );
                }
            }
        });

        return serde_json::json!({"connected": true, "host": host});
    }

    serde_json::json!({"connected": false, "error": "Unable to connect to host"})
}

#[tauri::command]
fn send_message(payload: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.refresh_device_id();

    if runtime.role == "host" {
        let _ = broadcast_message(&runtime.client_streams, &payload);
        return serde_json::json!({"sent": true, "role": "host"});
    }

    if let Some(stream) = runtime.client_stream.as_mut() {
        let _ = stream.write_all(format!("{payload}\n").as_bytes());
        return serde_json::json!({"sent": true, "role": "client"});
    }

    serde_json::json!({"sent": false, "error": "No active connection"})
}

#[tauri::command]
fn poll_messages(state: State<'_, AppState>) -> Vec<TransportMessage> {
    let mut runtime = state.0.lock().unwrap();
    let pending = runtime.pending_messages.lock().unwrap();
    let messages = pending.clone();
    drop(pending);
    runtime.pending_messages.lock().unwrap().clear();
    messages
}

#[tauri::command]
fn shutdown(state: State<'_, AppState>) -> serde_json::Value {
    let mut runtime = state.0.lock().unwrap();
    runtime.role = "standalone".to_string();
    runtime.current_host_id = None;
    runtime.client_stream = None;
    runtime.client_streams.lock().unwrap().clear();
    runtime.pending_messages.lock().unwrap().clear();
    serde_json::json!({"status": "stopped"})
}

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(RuntimeState {
            device_id: generate_device_id(),
            device_name: "BluePad Device".to_string(),
            role: "standalone".to_string(),
            pending_messages: Arc::new(Mutex::new(Vec::new())),
            client_streams: Arc::new(Mutex::new(Vec::new())),
            client_stream: None,
            host_port: None,
            current_host_id: None,
            known_hosts: Vec::new(),
        })))
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            set_device_name,
            start_host,
            scan_for_hosts,
            connect_to_host,
            send_message,
            poll_messages,
            shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
