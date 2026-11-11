// ═══════════════════════════════════════════════════════════════════════════
//  CoachYard · Cámara de swing nativa
//  Archivo: app-movil/ios/App/App/CamaraSwing.swift
//
//  Antes, "Tomar un video nuevo" usaba la cámara que trae el WebView de iOS
//  (<input capture>): sin estabilización, con la imagen comprimida y el
//  video "temblando". Esta cámara está hecha directo con AVFoundation, igual
//  que la app Cámara del iPhone:
//    · Estabilización de video (la más fuerte que tenga el teléfono:
//      cinemática extendida → cinemática → estándar), también en la vista previa.
//    · 1080p a 60 cuadros por segundo (opción de 120 / 240 para cámara lenta).
//    · Lentes 0.5× / 1× / 2× cuando el teléfono los tiene.
//    · Video en H.264 (.mp4): se reproduce en Safari y en Chrome.
//    · Toca la pantalla para enfocar.
//
//  Desde la web (js/mgl-camara.js):
//    CamaraSwing.grabar({ fps: 60 })  → { path, nombre, bytes, duracion, fps } o { cancelado: true }
//    CamaraSwing.leer({ path, offset, length }) → { data (base64), bytes }
//    CamaraSwing.borrar({ path })
//
//  AppBridgeViewController registra el plugin (SceneDelegate lo usa en vez
//  de CAPBridgeViewController).
// ═══════════════════════════════════════════════════════════════════════════

import UIKit
import AVFoundation
import Capacitor

// MARK: - Controlador principal de la app (registra el plugin local)

class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CamaraSwingPlugin())
    }
}

// MARK: - Plugin

@objc(CamaraSwingPlugin)
public class CamaraSwingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CamaraSwingPlugin"
    public let jsName = "CamaraSwing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "grabar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "borrar", returnType: CAPPluginReturnPromise)
    ]

    static var carpeta: URL {
        return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("camaraswing", isDirectory: true)
    }

    // Solo se pueden leer / borrar archivos que creó esta cámara
    private func rutaPermitida(_ path: String?) -> String? {
        guard let p = path, !p.isEmpty else { return nil }
        let limpia = URL(fileURLWithPath: p).standardizedFileURL.resolvingSymlinksInPath().path
        let base = CamaraSwingPlugin.carpeta.standardizedFileURL.resolvingSymlinksInPath().path
        return limpia.hasPrefix(base + "/") ? limpia : nil
    }

    @objc func grabar(_ call: CAPPluginCall) {
        let fps = call.getInt("fps") ?? 60
        DispatchQueue.main.async {
            guard let base = self.bridge?.viewController else {
                call.reject("No se pudo abrir la cámara")
                return
            }
            // Se borran los videos de grabaciones anteriores
            let fm = FileManager.default
            try? fm.removeItem(at: CamaraSwingPlugin.carpeta)
            try? fm.createDirectory(at: CamaraSwingPlugin.carpeta, withIntermediateDirectories: true)

            var arriba: UIViewController = base
            while let p = arriba.presentedViewController { arriba = p }

            let vc = CamaraSwingViewController()
            vc.fpsPedido = fps
            vc.alTerminar = { resultado in
                if let r = resultado { call.resolve(r) } else { call.resolve(["cancelado": true]) }
            }
            vc.modalPresentationStyle = .fullScreen
            arriba.present(vc, animated: true)
        }
    }

    @objc func leer(_ call: CAPPluginCall) {
        guard let path = rutaPermitida(call.getString("path")) else {
            call.reject("Archivo no permitido")
            return
        }
        let offset = max(0, call.getInt("offset") ?? 0)
        let largo = min(max(1, call.getInt("length") ?? 3_000_000), 8_000_000)
        DispatchQueue.global(qos: .userInitiated).async {
            guard let h = FileHandle(forReadingAtPath: path) else {
                call.reject("No se encontró el video")
                return
            }
            defer { try? h.close() }
            do {
                try h.seek(toOffset: UInt64(offset))
                let data = try h.read(upToCount: largo) ?? Data()
                call.resolve(["data": data.base64EncodedString(), "bytes": data.count])
            } catch {
                call.reject("No se pudo leer el video")
            }
        }
    }

    @objc func borrar(_ call: CAPPluginCall) {
        if let path = rutaPermitida(call.getString("path")) {
            try? FileManager.default.removeItem(atPath: path)
        }
        call.resolve()
    }
}

// MARK: - Pantalla de la cámara

final class CamaraSwingViewController: UIViewController, AVCaptureFileOutputRecordingDelegate {

    var fpsPedido = 60
    var alTerminar: (([String: Any]?) -> Void)?

    private let session = AVCaptureSession()
    private let colaSesion = DispatchQueue(label: "golf.coachyard.camaraswing")
    private let salida = AVCaptureMovieFileOutput()
    private var dispositivo: AVCaptureDevice?
    private var preview: AVCaptureVideoPreviewLayer!

    private var fpsDisponibles: [Int] = []
    private var fps = 60
    private var lentes: [(titulo: String, zoom: CGFloat)] = []
    private var lenteActual = 0
    private var grabando = false
    private var terminado = false
    private var orientacionGrabacion: UIDeviceOrientation = .portrait
    private var reloj: Timer?

    // Vistas
    private let vistaPreview = UIView()
    private let btnCerrar = UIButton(type: .system)
    private let btnFps = UIButton(type: .system)
    private let lblTiempo = UILabel()
    private let puntoRojo = UIView()
    private let cajaTiempo = UIView()
    private let btnGrabar = UIButton(type: .custom)
    private let centroGrabar = UIView()
    private let filaLentes = UIStackView()
    private let aviso = UILabel()
    private let btnAjustes = UIButton(type: .system)
    private let cargando = UIActivityIndicatorView(style: .large)
    private let marcoFoco = UIView()

    override var prefersStatusBarHidden: Bool { return true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { return .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { return .portrait }

    // MARK: Ciclo de vida

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        armarVistas()
        pedirPermisos()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
        reloj?.invalidate()
        let s = session
        colaSesion.async { if s.isRunning { s.stopRunning() } }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = vistaPreview.bounds
    }

    // MARK: Permisos

    private func pedirPermisos() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            pedirMicrofonoYConfigurar()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async {
                    if ok { self.pedirMicrofonoYConfigurar() } else { self.mostrarSinPermiso() }
                }
            }
        default:
            mostrarSinPermiso()
        }
    }

    private func pedirMicrofonoYConfigurar() {
        // El micrófono es opcional (el sonido del impacto ayuda, pero sin él igual se graba)
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                self.colaSesion.async { self.configurarSesion() }
            }
        } else {
            colaSesion.async { self.configurarSesion() }
        }
    }

    private func mostrarSinPermiso() {
        cargando.stopAnimating()
        aviso.text = "CoachYard no tiene permiso para usar la cámara.\nActívalo en Ajustes → CoachYard → Cámara."
        aviso.isHidden = false
        btnAjustes.isHidden = false
        btnGrabar.isHidden = true
        btnFps.isHidden = true
    }

    @objc private func abrirAjustes() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Configuración de la cámara

    private func elegirDispositivo() -> AVCaptureDevice? {
        let tipos: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera
        ]
        let d = AVCaptureDevice.DiscoverySession(deviceTypes: tipos, mediaType: .video, position: .back)
        for t in tipos {
            if let x = d.devices.first(where: { $0.deviceType == t }) { return x }
        }
        return AVCaptureDevice.default(for: .video)
    }

    private func puntajeEstabilizacion(_ f: AVCaptureDevice.Format) -> Int {
        if f.isVideoStabilizationModeSupported(.cinematicExtended) { return 3000 }
        if f.isVideoStabilizationModeSupported(.cinematic) { return 2000 }
        if f.isVideoStabilizationModeSupported(.standard) { return 1000 }
        return 0
    }

    // Mejor formato para esos cuadros por segundo: 1080p 16:9, 8 bits (H.264),
    // con la estabilización más fuerte disponible. Nada de 4K (archivos enormes).
    private func elegirFormato(_ d: AVCaptureDevice, fps: Int) -> AVCaptureDevice.Format? {
        var mejor: AVCaptureDevice.Format?
        var mejorPuntaje = -1
        for f in d.formats {
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            if sub != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange &&
                sub != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange { continue }
            if !f.videoSupportedFrameRateRanges.contains(where: { $0.maxFrameRate >= Double(fps) - 0.5 }) { continue }
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            if dim.width > 1920 || dim.width < 1280 { continue }
            var p = dim.width >= 1920 ? 10000 : Int(dim.width) * 2
            if Int(dim.width) * 9 != Int(dim.height) * 16 { p -= 6000 }   // preferir 16:9
            p += puntajeEstabilizacion(f)
            if sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange { p += 1 }
            if p > mejorPuntaje { mejorPuntaje = p; mejor = f }
        }
        return mejor
    }

    private func configurarSesion() {
        guard let d = elegirDispositivo() else {
            DispatchQueue.main.async { self.mostrarError("No se encontró la cámara del teléfono.") }
            return
        }
        dispositivo = d
        fpsDisponibles = [60, 120, 240].filter { elegirFormato(d, fps: $0) != nil }
        if fpsDisponibles.isEmpty { fpsDisponibles = [30] }
        fps = fpsDisponibles.contains(fpsPedido) ? fpsPedido : fpsDisponibles[0]

        session.beginConfiguration()
        do {
            let entrada = try AVCaptureDeviceInput(device: d)
            if session.canAddInput(entrada) { session.addInput(entrada) }
        } catch {
            session.commitConfiguration()
            DispatchQueue.main.async { self.mostrarError("No se pudo abrir la cámara.") }
            return
        }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
           let mic = AVCaptureDevice.default(for: .audio),
           let entradaMic = try? AVCaptureDeviceInput(device: mic),
           session.canAddInput(entradaMic) {
            session.addInput(entradaMic)
        }
        if session.canAddOutput(salida) { session.addOutput(salida) }
        aplicarFormato()
        session.commitConfiguration()
        session.startRunning()

        DispatchQueue.main.async {
            self.cargando.stopAnimating()
            self.armarLentes()
            self.actualizarBotonFps()
            self.btnGrabar.isEnabled = true
            self.btnGrabar.alpha = 1
        }
    }

    // Se llama dentro de begin/commitConfiguration, en colaSesion
    private func aplicarFormato() {
        guard let d = dispositivo else { return }
        let formato = elegirFormato(d, fps: fps)
        do {
            try d.lockForConfiguration()
            if let f = formato {
                d.activeFormat = f
                let dur = CMTime(value: 1, timescale: CMTimeScale(fps))
                d.activeVideoMinFrameDuration = dur
                d.activeVideoMaxFrameDuration = dur
            } else {
                session.sessionPreset = .high
            }
            if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
            if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
            if d.isLowLightBoostSupported { d.automaticallyEnablesLowLightBoostWhenAvailable = true }
            d.unlockForConfiguration()
        } catch {}

        if let c = salida.connection(with: .video) {
            if c.isVideoStabilizationSupported {
                let f = formato ?? d.activeFormat
                if f.isVideoStabilizationModeSupported(.cinematicExtended) {
                    c.preferredVideoStabilizationMode = .cinematicExtended
                } else if f.isVideoStabilizationModeSupported(.cinematic) {
                    c.preferredVideoStabilizationMode = .cinematic
                } else if f.isVideoStabilizationModeSupported(.standard) {
                    c.preferredVideoStabilizationMode = .standard
                } else {
                    c.preferredVideoStabilizationMode = .auto
                }
            }
            // H.264 en vez de HEVC: así el video también se ve en Chrome
            if salida.availableVideoCodecTypes.contains(.h264) {
                salida.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.h264], for: c)
            }
        }
        DispatchQueue.main.async { self.ajustarPreview() }
    }

    private func ajustarPreview() {
        guard let c = preview?.connection else { return }
        if #available(iOS 17.0, *) {
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
            // la vista previa también estabilizada, como en la app Cámara
            if c.isVideoStabilizationSupported { c.preferredVideoStabilizationMode = .previewOptimized }
        } else {
            if c.isVideoOrientationSupported { c.videoOrientation = .portrait }
        }
    }

    // MARK: Lentes (0.5× / 1× / 2×)

    private func armarLentes() {
        filaLentes.arrangedSubviews.forEach { $0.removeFromSuperview() }
        lentes = []
        guard let d = dispositivo else { return }
        let maxZoom = min(d.activeFormat.videoMaxZoomFactor, 12)
        let cortes = d.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        var uno: CGFloat = 1
        if d.deviceType == .builtInTripleCamera || d.deviceType == .builtInDualWideCamera {
            uno = cortes.first ?? 2
            lentes.append((titulo: ".5", zoom: 1))
        }
        lentes.append((titulo: "1×", zoom: uno))
        if uno * 2 <= maxZoom { lentes.append((titulo: "2", zoom: uno * 2)) }
        lenteActual = lentes.firstIndex(where: { $0.titulo == "1×" }) ?? 0
        if lentes.count < 2 { filaLentes.isHidden = true; return }
        filaLentes.isHidden = false
        for (i, l) in lentes.enumerated() {
            let b = UIButton(type: .custom)
            b.tag = i
            b.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .bold)
            b.setTitle(l.titulo, for: .normal)
            b.backgroundColor = UIColor(white: 0, alpha: 0.45)
            b.layer.cornerRadius = 19
            b.translatesAutoresizingMaskIntoConstraints = false
            b.widthAnchor.constraint(equalToConstant: 38).isActive = true
            b.heightAnchor.constraint(equalToConstant: 38).isActive = true
            b.addTarget(self, action: #selector(tocarLente(_:)), for: .touchUpInside)
            filaLentes.addArrangedSubview(b)
        }
        pintarLentes()
        aplicarZoom(lentes[lenteActual].zoom)
    }

    private func pintarLentes() {
        let oro = UIColor(red: 212/255, green: 197/255, blue: 169/255, alpha: 1)
        for v in filaLentes.arrangedSubviews {
            guard let b = v as? UIButton else { continue }
            let on = b.tag == lenteActual
            b.setTitleColor(on ? oro : .white, for: .normal)
            let t = lentes[b.tag].titulo
            b.setTitle(on && t != "1×" ? (t + "×") : t, for: .normal)
        }
    }

    @objc private func tocarLente(_ b: UIButton) {
        guard b.tag < lentes.count else { return }
        lenteActual = b.tag
        pintarLentes()
        aplicarZoom(lentes[b.tag].zoom)
    }

    private func aplicarZoom(_ z: CGFloat) {
        guard let d = dispositivo else { return }
        colaSesion.async {
            do {
                try d.lockForConfiguration()
                let maxZ = d.activeFormat.videoMaxZoomFactor
                d.ramp(toVideoZoomFactor: max(1, min(z, maxZ)), withRate: 12)
                d.unlockForConfiguration()
            } catch {}
        }
    }

    // MARK: Cuadros por segundo

    private func actualizarBotonFps() {
        btnFps.setTitle(fps >= 120 ? "\(fps) FPS · LENTO" : "\(fps) FPS", for: .normal)
        btnFps.isHidden = fpsDisponibles.count < 2
    }

    @objc private func cambiarFps() {
        guard !grabando, fpsDisponibles.count > 1 else { return }
        let i = fpsDisponibles.firstIndex(of: fps) ?? 0
        fps = fpsDisponibles[(i + 1) % fpsDisponibles.count]
        actualizarBotonFps()
        let zoom = lentes.isEmpty ? 1 : lentes[lenteActual].zoom
        colaSesion.async {
            self.session.beginConfiguration()
            self.aplicarFormato()
            self.session.commitConfiguration()
            DispatchQueue.main.async { self.aplicarZoom(zoom) }
        }
    }

    // MARK: Enfoque

    @objc private func tocarPantalla(_ g: UITapGestureRecognizer) {
        guard let d = dispositivo, let preview = preview else { return }
        let punto = g.location(in: vistaPreview)
        let p = preview.captureDevicePointConverted(fromLayerPoint: punto)
        colaSesion.async {
            do {
                try d.lockForConfiguration()
                if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = p; d.focusMode = .autoFocus }
                if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = p; d.exposureMode = .autoExpose }
                d.isSubjectAreaChangeMonitoringEnabled = true
                d.unlockForConfiguration()
            } catch {}
        }
        marcoFoco.center = punto
        marcoFoco.alpha = 1
        marcoFoco.transform = CGAffineTransform(scaleX: 1.4, y: 1.4)
        UIView.animate(withDuration: 0.25, animations: { self.marcoFoco.transform = .identity }) { _ in
            UIView.animate(withDuration: 0.4, delay: 0.8, options: [], animations: { self.marcoFoco.alpha = 0 })
        }
    }

    // MARK: Grabar

    @objc private func tocarGrabar() {
        if grabando { detener() } else { empezar() }
    }

    private func orientacionActual() -> UIDeviceOrientation {
        let o = UIDevice.current.orientation
        switch o {
        case .portrait, .landscapeLeft, .landscapeRight, .portraitUpsideDown: return o
        default: return .portrait
        }
    }

    private func empezar() {
        guard !grabando, !salida.isRecording else { return }
        orientacionGrabacion = orientacionActual()
        let nombre = "swing-" + String(Int(Date().timeIntervalSince1970)) + ".mov"
        let url = CamaraSwingPlugin.carpeta.appendingPathComponent(nombre)
        try? FileManager.default.createDirectory(at: CamaraSwingPlugin.carpeta, withIntermediateDirectories: true)
        let o = orientacionGrabacion
        grabando = true
        pintarGrabando(true)
        colaSesion.async {
            if let c = self.salida.connection(with: .video) {
                if #available(iOS 17.0, *) {
                    let angulo: CGFloat
                    switch o {
                    case .landscapeLeft: angulo = 0
                    case .landscapeRight: angulo = 180
                    case .portraitUpsideDown: angulo = 270
                    default: angulo = 90
                    }
                    if c.isVideoRotationAngleSupported(angulo) { c.videoRotationAngle = angulo }
                } else if c.isVideoOrientationSupported {
                    switch o {
                    case .landscapeLeft: c.videoOrientation = .landscapeRight
                    case .landscapeRight: c.videoOrientation = .landscapeLeft
                    case .portraitUpsideDown: c.videoOrientation = .portraitUpsideDown
                    default: c.videoOrientation = .portrait
                    }
                }
            }
            self.salida.startRecording(to: url, recordingDelegate: self)
        }
    }

    private func detener() {
        guard grabando else { return }
        btnGrabar.isEnabled = false
        colaSesion.async { if self.salida.isRecording { self.salida.stopRecording() } }
    }

    private func pintarGrabando(_ si: Bool) {
        btnFps.isHidden = si || fpsDisponibles.count < 2
        btnCerrar.isHidden = si
        cajaTiempo.isHidden = !si
        lblTiempo.text = "00:00"
        UIView.animate(withDuration: 0.2) {
            self.centroGrabar.layer.cornerRadius = si ? 8 : 29
            self.centroGrabar.transform = si ? CGAffineTransform(scaleX: 0.55, y: 0.55) : .identity
        }
        reloj?.invalidate()
        if si {
            let inicio = Date()
            reloj = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                let s = Int(Date().timeIntervalSince(inicio))
                self.lblTiempo.text = String(format: "%02d:%02d", s / 60, s % 60)
                self.puntoRojo.alpha = (s % 2 == 0) ? 1 : 0.35
            }
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL,
                    from connections: [AVCaptureConnection], error: Error?) {
        var ok = true
        if let e = error as NSError? {
            ok = (e.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool) ?? false
        }
        let duracion = CMTimeGetSeconds(output.recordedDuration)
        DispatchQueue.main.async {
            self.grabando = false
            self.reloj?.invalidate()
            if !ok || !FileManager.default.fileExists(atPath: outputFileURL.path) {
                self.pintarGrabando(false)
                self.btnGrabar.isEnabled = true
                self.mostrarError("No se pudo guardar el video. Intenta de nuevo.")
                return
            }
            self.cajaTiempo.isHidden = true
            self.btnGrabar.isHidden = true
            self.filaLentes.isHidden = true
            self.cargando.startAnimating()
            self.pasarAMp4(outputFileURL, duracion: duracion.isFinite ? duracion : 0)
        }
    }

    // .mov → .mp4 sin volver a comprimir (passthrough): es solo cambiar el envase
    private func pasarAMp4(_ mov: URL, duracion: Double) {
        let mp4 = mov.deletingPathExtension().appendingPathExtension("mp4")
        let fpsUsado = fps
        func entregar(_ url: URL) {
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let bytes = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let r: [String: Any] = [
                "path": url.path,
                "nombre": url.lastPathComponent,
                "tipo": url.pathExtension == "mp4" ? "video/mp4" : "video/quicktime",
                "bytes": bytes,
                "duracion": duracion,
                "fps": fpsUsado
            ]
            DispatchQueue.main.async { self.terminar(r) }
        }
        let asset = AVURLAsset(url: mov)
        guard let exp = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            entregar(mov)
            return
        }
        exp.outputURL = mp4
        exp.outputFileType = .mp4
        exp.shouldOptimizeForNetworkUse = true
        exp.exportAsynchronously {
            if exp.status == .completed, FileManager.default.fileExists(atPath: mp4.path) {
                try? FileManager.default.removeItem(at: mov)
                entregar(mp4)
            } else {
                entregar(mov)
            }
        }
    }

    // MARK: Cerrar

    @objc private func cerrar() {
        if grabando { return }
        terminar(nil)
    }

    private func terminar(_ r: [String: Any]?) {
        if terminado { return }
        terminado = true
        let cb = alTerminar
        alTerminar = nil
        dismiss(animated: true) { cb?(r) }
    }

    private func mostrarError(_ msg: String) {
        cargando.stopAnimating()
        aviso.text = msg
        aviso.isHidden = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if self.btnAjustes.isHidden { self.aviso.isHidden = true }
        }
    }

    // MARK: Vistas

    private func armarVistas() {
        let oro = UIColor(red: 212/255, green: 197/255, blue: 169/255, alpha: 1)

        vistaPreview.translatesAutoresizingMaskIntoConstraints = false
        vistaPreview.backgroundColor = .black
        view.addSubview(vistaPreview)
        preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        vistaPreview.layer.addSublayer(preview)
        vistaPreview.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tocarPantalla(_:))))

        marcoFoco.frame = CGRect(x: 0, y: 0, width: 74, height: 74)
        marcoFoco.layer.borderColor = oro.cgColor
        marcoFoco.layer.borderWidth = 1.5
        marcoFoco.alpha = 0
        marcoFoco.isUserInteractionEnabled = false
        vistaPreview.addSubview(marcoFoco)

        // Cerrar
        btnCerrar.translatesAutoresizingMaskIntoConstraints = false
        btnCerrar.setTitle("✕", for: .normal)
        btnCerrar.titleLabel?.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        btnCerrar.tintColor = .white
        btnCerrar.backgroundColor = UIColor(white: 0, alpha: 0.45)
        btnCerrar.layer.cornerRadius = 22
        btnCerrar.addTarget(self, action: #selector(cerrar), for: .touchUpInside)
        view.addSubview(btnCerrar)

        // FPS
        btnFps.translatesAutoresizingMaskIntoConstraints = false
        btnFps.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        btnFps.tintColor = oro
        btnFps.backgroundColor = UIColor(white: 0, alpha: 0.45)
        btnFps.layer.cornerRadius = 17
        btnFps.contentEdgeInsets = UIEdgeInsets(top: 0, left: 14, bottom: 0, right: 14)
        btnFps.addTarget(self, action: #selector(cambiarFps), for: .touchUpInside)
        btnFps.isHidden = true
        view.addSubview(btnFps)

        // Tiempo
        cajaTiempo.translatesAutoresizingMaskIntoConstraints = false
        cajaTiempo.backgroundColor = UIColor(red: 0.85, green: 0.18, blue: 0.18, alpha: 0.9)
        cajaTiempo.layer.cornerRadius = 6
        cajaTiempo.isHidden = true
        view.addSubview(cajaTiempo)
        puntoRojo.translatesAutoresizingMaskIntoConstraints = false
        puntoRojo.backgroundColor = .white
        puntoRojo.layer.cornerRadius = 4
        cajaTiempo.addSubview(puntoRojo)
        lblTiempo.translatesAutoresizingMaskIntoConstraints = false
        lblTiempo.textColor = .white
        lblTiempo.font = UIFont.monospacedDigitSystemFont(ofSize: 17, weight: .semibold)
        lblTiempo.text = "00:00"
        cajaTiempo.addSubview(lblTiempo)

        // Botón grabar
        btnGrabar.translatesAutoresizingMaskIntoConstraints = false
        btnGrabar.layer.cornerRadius = 39
        btnGrabar.layer.borderWidth = 5
        btnGrabar.layer.borderColor = UIColor.white.cgColor
        btnGrabar.isEnabled = false
        btnGrabar.alpha = 0.5
        btnGrabar.addTarget(self, action: #selector(tocarGrabar), for: .touchUpInside)
        view.addSubview(btnGrabar)
        centroGrabar.translatesAutoresizingMaskIntoConstraints = false
        centroGrabar.backgroundColor = UIColor(red: 0.92, green: 0.22, blue: 0.2, alpha: 1)
        centroGrabar.layer.cornerRadius = 29
        centroGrabar.isUserInteractionEnabled = false
        btnGrabar.addSubview(centroGrabar)

        // Lentes
        filaLentes.translatesAutoresizingMaskIntoConstraints = false
        filaLentes.axis = .horizontal
        filaLentes.spacing = 10
        filaLentes.isHidden = true
        view.addSubview(filaLentes)

        // Avisos
        aviso.translatesAutoresizingMaskIntoConstraints = false
        aviso.textColor = .white
        aviso.numberOfLines = 0
        aviso.textAlignment = .center
        aviso.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        aviso.backgroundColor = UIColor(white: 0, alpha: 0.6)
        aviso.layer.cornerRadius = 10
        aviso.clipsToBounds = true
        aviso.isHidden = true
        view.addSubview(aviso)
        btnAjustes.translatesAutoresizingMaskIntoConstraints = false
        btnAjustes.setTitle("Abrir Ajustes", for: .normal)
        btnAjustes.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        btnAjustes.tintColor = .black
        btnAjustes.backgroundColor = oro
        btnAjustes.layer.cornerRadius = 22
        btnAjustes.contentEdgeInsets = UIEdgeInsets(top: 0, left: 22, bottom: 0, right: 22)
        btnAjustes.isHidden = true
        btnAjustes.addTarget(self, action: #selector(abrirAjustes), for: .touchUpInside)
        view.addSubview(btnAjustes)

        cargando.translatesAutoresizingMaskIntoConstraints = false
        cargando.color = oro
        cargando.hidesWhenStopped = true
        cargando.startAnimating()
        view.addSubview(cargando)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            vistaPreview.topAnchor.constraint(equalTo: view.topAnchor),
            vistaPreview.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            vistaPreview.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            vistaPreview.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            btnCerrar.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            btnCerrar.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            btnCerrar.widthAnchor.constraint(equalToConstant: 44),
            btnCerrar.heightAnchor.constraint(equalToConstant: 44),

            btnFps.centerYAnchor.constraint(equalTo: btnCerrar.centerYAnchor),
            btnFps.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            btnFps.heightAnchor.constraint(equalToConstant: 34),

            cajaTiempo.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cajaTiempo.centerYAnchor.constraint(equalTo: btnCerrar.centerYAnchor),
            cajaTiempo.heightAnchor.constraint(equalToConstant: 32),
            puntoRojo.leadingAnchor.constraint(equalTo: cajaTiempo.leadingAnchor, constant: 10),
            puntoRojo.centerYAnchor.constraint(equalTo: cajaTiempo.centerYAnchor),
            puntoRojo.widthAnchor.constraint(equalToConstant: 8),
            puntoRojo.heightAnchor.constraint(equalToConstant: 8),
            lblTiempo.leadingAnchor.constraint(equalTo: puntoRojo.trailingAnchor, constant: 7),
            lblTiempo.trailingAnchor.constraint(equalTo: cajaTiempo.trailingAnchor, constant: -11),
            lblTiempo.centerYAnchor.constraint(equalTo: cajaTiempo.centerYAnchor),

            btnGrabar.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            btnGrabar.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24),
            btnGrabar.widthAnchor.constraint(equalToConstant: 78),
            btnGrabar.heightAnchor.constraint(equalToConstant: 78),
            centroGrabar.centerXAnchor.constraint(equalTo: btnGrabar.centerXAnchor),
            centroGrabar.centerYAnchor.constraint(equalTo: btnGrabar.centerYAnchor),
            centroGrabar.widthAnchor.constraint(equalToConstant: 58),
            centroGrabar.heightAnchor.constraint(equalToConstant: 58),

            filaLentes.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            filaLentes.bottomAnchor.constraint(equalTo: btnGrabar.topAnchor, constant: -22),

            aviso.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            aviso.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 28),
            aviso.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -28),
            btnAjustes.topAnchor.constraint(equalTo: aviso.bottomAnchor, constant: 18),
            btnAjustes.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            btnAjustes.heightAnchor.constraint(equalToConstant: 44),

            cargando.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cargando.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
}
