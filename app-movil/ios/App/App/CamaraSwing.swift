// ═══════════════════════════════════════════════════════════════════════════
//  CoachYard · Cámara de swing nativa
//  Archivo: app-movil/ios/App/App/CamaraSwing.swift
//
//  Antes, "Tomar un video nuevo" usaba la cámara que trae el WebView de iOS
//  (<input capture>): sin estabilización y con la imagen comprimida. Esta
//  cámara está hecha directo con AVFoundation y se parece a la app Cámara:
//    · Estabilización: la más fuerte del teléfono (cinemática extendida
//      mejorada en iOS 18 → extendida → cinemática → estándar), también en
//      la vista previa. Formatos sin "binning" (más detalle) y Video HDR.
//    · Arriba "HD · 60" como en el iPhone: HD / 4K y 30 / 60 fps.
//    · Modos VIDEO y CÁMARA LENTA (120 / 240 fps).
//    · Lentes .5 / 1× / 2 / 3 o 5 según el teléfono. Toca para enfocar.
//    · Varios videos seguidos sin cerrar la cámara (miniatura + "Listo").
//    · H.264 (.mp4): se reproduce en Safari y en Chrome. No se guarda nada
//      en la galería del teléfono.
//
//  Desde la web (js/mgl-camara.js):
//    CamaraSwing.grabar({ fps: 60 })
//        → { videos: [{ path, nombre, tipo, bytes, duracion, fps }, ...] }
//          (+ los campos del primero sueltos, para la web antigua)
//          o { cancelado: true }
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

    private enum Modo { case video, lento }

    private let session = AVCaptureSession()
    private let colaSesion = DispatchQueue(label: "golf.coachyard.camaraswing")
    private let salida = AVCaptureMovieFileOutput()
    private var dispositivo: AVCaptureDevice?
    private var preview: AVCaptureVideoPreviewLayer!

    // Ajustes (como la app Cámara)
    private var modo: Modo = .video
    private var en4K = false
    private var fpsVideo = 60
    private var fpsLento = 240
    private var hay4K = false
    private var fpsVideoDisp: [Int] = []
    private var fpsLentoDisp: [Int] = []
    private var fpsActual: Int { return modo == .lento ? fpsLento : fpsVideo }

    private var lentes: [(titulo: String, zoom: CGFloat)] = []
    private var lenteActual = 0
    private var grabando = false
    private var terminado = false
    private var reloj: Timer?

    // Videos de esta sesión
    private var clips: [[String: Any]] = []
    private let grupoExport = DispatchGroup()
    private var exportando = 0

    // Vistas
    private let vistaPreview = UIView()
    private let btnCerrar = UIButton(type: .system)
    private let filaAjustes = UIStackView()
    private let btnRes = UIButton(type: .custom)
    private let btnFps = UIButton(type: .custom)
    private let lblTiempo = UILabel()
    private let puntoRojo = UIView()
    private let cajaTiempo = UIView()
    private let btnGrabar = UIButton(type: .custom)
    private let centroGrabar = UIView()
    private let filaLentes = UIStackView()
    private let filaModos = UIStackView()
    private let btnModoLento = UIButton(type: .custom)
    private let btnModoVideo = UIButton(type: .custom)
    private let miniatura = UIImageView()
    private let lblCuenta = UILabel()
    private let btnListo = UIButton(type: .custom)
    private let aviso = UILabel()
    private let btnAjustes = UIButton(type: .system)
    private let cargando = UIActivityIndicatorView(style: .large)
    private let marcoFoco = UIView()

    private let oro = UIColor(red: 212/255, green: 197/255, blue: 169/255, alpha: 1)
    private let amarillo = UIColor(red: 1, green: 0.8, blue: 0.0, alpha: 1)

    override var prefersStatusBarHidden: Bool { return true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { return .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { return .portrait }

    // MARK: Ciclo de vida

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if fpsPedido >= 120 { modo = .lento; fpsLento = fpsPedido >= 240 ? 240 : 120 }
        else { fpsVideo = fpsPedido <= 30 ? 30 : 60 }
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
        filaAjustes.isHidden = true
        filaModos.isHidden = true
    }

    @objc private func abrirAjustes() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Formatos

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

    private func modoEstabilizacion(_ f: AVCaptureDevice.Format) -> AVCaptureVideoStabilizationMode? {
        if #available(iOS 18.0, *) {
            if f.isVideoStabilizationModeSupported(.cinematicExtendedEnhanced) { return .cinematicExtendedEnhanced }
        }
        if f.isVideoStabilizationModeSupported(.cinematicExtended) { return .cinematicExtended }
        if f.isVideoStabilizationModeSupported(.cinematic) { return .cinematic }
        if f.isVideoStabilizationModeSupported(.standard) { return .standard }
        return nil
    }

    private func puntajeEstabilizacion(_ f: AVCaptureDevice.Format) -> Int {
        guard let m = modoEstabilizacion(f) else { return 0 }
        if #available(iOS 18.0, *) { if m == .cinematicExtendedEnhanced { return 4000 } }
        switch m {
        case .cinematicExtended: return 3000
        case .cinematic: return 2000
        default: return 1000
        }
    }

    // Mejor formato: 16:9, 8 bits (H.264), sin "binning" (más detalle) y con
    // la estabilización más fuerte. HD = 1080p (720p solo si no hay otra en
    // cámara lenta). 4K = 2160p.
    private func elegirFormato(_ d: AVCaptureDevice, fps: Int, k4: Bool) -> AVCaptureDevice.Format? {
        var mejor: AVCaptureDevice.Format?
        var mejorPuntaje = -1
        for f in d.formats {
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            if sub != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange &&
                sub != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange { continue }
            if !f.videoSupportedFrameRateRanges.contains(where: { $0.maxFrameRate >= Double(fps) - 0.5 }) { continue }
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            if Int(dim.width) * 9 != Int(dim.height) * 16 { continue }
            if k4 {
                if dim.width != 3840 { continue }
            } else {
                if dim.width > 1920 || dim.width < 1280 { continue }
            }
            var p = dim.width >= 1920 ? 20000 : 0
            if !f.isVideoBinned { p += 5000 }
            p += puntajeEstabilizacion(f)
            if f.isVideoHDRSupported { p += 50 }
            if sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange { p += 1 }
            if p > mejorPuntaje { mejorPuntaje = p; mejor = f }
        }
        return mejor
    }

    private func calcularDisponibles(_ d: AVCaptureDevice) {
        hay4K = elegirFormato(d, fps: 30, k4: true) != nil
        fpsLentoDisp = [120, 240].filter { elegirFormato(d, fps: $0, k4: false) != nil }
        if !fpsLentoDisp.contains(fpsLento) { fpsLento = fpsLentoDisp.last ?? 120 }
        if en4K && !hay4K { en4K = false }
        recalcularFpsVideo(d)
    }

    private func recalcularFpsVideo(_ d: AVCaptureDevice) {
        fpsVideoDisp = [30, 60].filter { elegirFormato(d, fps: $0, k4: en4K) != nil }
        if fpsVideoDisp.isEmpty { fpsVideoDisp = [30] }
        if !fpsVideoDisp.contains(fpsVideo) { fpsVideo = fpsVideoDisp.last ?? 30 }
    }

    // MARK: Sesión

    private func configurarSesion() {
        guard let d = elegirDispositivo() else {
            DispatchQueue.main.async { self.mostrarError("No se encontró la cámara del teléfono.") }
            return
        }
        dispositivo = d
        calcularDisponibles(d)
        if modo == .lento && fpsLentoDisp.isEmpty { modo = .video }

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
            self.pintarAjustes()
            self.btnGrabar.isEnabled = true
            self.btnGrabar.alpha = 1
        }
    }

    // Se llama dentro de begin/commitConfiguration, en colaSesion
    private func aplicarFormato() {
        guard let d = dispositivo else { return }
        let fps = fpsActual
        let formato = elegirFormato(d, fps: fps, k4: modo == .video && en4K)
        do {
            try d.lockForConfiguration()
            if let f = formato {
                d.activeFormat = f
                let dur = CMTime(value: 1, timescale: CMTimeScale(fps))
                d.activeVideoMinFrameDuration = dur
                d.activeVideoMaxFrameDuration = dur
                // Video HDR (8 bits): más rango de luz, como la app Cámara
                if f.isVideoHDRSupported {
                    d.automaticallyAdjustsVideoHDREnabled = false
                    d.isVideoHDREnabled = true
                } else {
                    d.automaticallyAdjustsVideoHDREnabled = true
                }
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
                c.preferredVideoStabilizationMode = modoEstabilizacion(formato ?? d.activeFormat) ?? .auto
            }
            // H.264 en vez de HEVC: así el video también se ve en Chrome
            if salida.availableVideoCodecTypes.contains(.h264) {
                salida.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.h264], for: c)
            }
        }
        DispatchQueue.main.async { self.ajustarPreview() }
    }

    private func reconfigurar() {
        let zoom = lentes.isEmpty ? 1 : lentes[lenteActual].zoom
        pintarAjustes()
        colaSesion.async {
            self.session.beginConfiguration()
            self.aplicarFormato()
            self.session.commitConfiguration()
            DispatchQueue.main.async {
                self.armarLentes(zoomPreferido: zoom)
            }
        }
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

    // MARK: Ajustes de arriba (HD · 60) y modos (VIDEO / CÁMARA LENTA)

    private func pintarAjustes() {
        let res = modo == .lento ? "HD" : (en4K ? "4K" : "HD")
        btnRes.setTitle(res, for: .normal)
        btnRes.isEnabled = modo == .video && hay4K
        btnRes.setTitleColor(modo == .video && hay4K ? .white : UIColor(white: 1, alpha: 0.5), for: .normal)
        btnFps.setTitle(String(fpsActual), for: .normal)
        let opciones = modo == .lento ? fpsLentoDisp : fpsVideoDisp
        btnFps.isEnabled = opciones.count > 1
        btnFps.setTitleColor(opciones.count > 1 ? .white : UIColor(white: 1, alpha: 0.5), for: .normal)
        filaAjustes.isHidden = grabando
        btnModoLento.isHidden = fpsLentoDisp.isEmpty
        btnModoLento.setTitleColor(modo == .lento ? amarillo : .white, for: .normal)
        btnModoVideo.setTitleColor(modo == .video ? amarillo : .white, for: .normal)
    }

    @objc private func tocarRes() {
        guard !grabando, modo == .video, hay4K, let d = dispositivo else { return }
        en4K.toggle()
        recalcularFpsVideo(d)
        reconfigurar()
    }

    @objc private func tocarFps() {
        guard !grabando else { return }
        if modo == .lento {
            guard fpsLentoDisp.count > 1 else { return }
            let i = fpsLentoDisp.firstIndex(of: fpsLento) ?? 0
            fpsLento = fpsLentoDisp[(i + 1) % fpsLentoDisp.count]
        } else {
            guard fpsVideoDisp.count > 1 else { return }
            let i = fpsVideoDisp.firstIndex(of: fpsVideo) ?? 0
            fpsVideo = fpsVideoDisp[(i + 1) % fpsVideoDisp.count]
        }
        reconfigurar()
    }

    @objc private func tocarModoVideo() { cambiarModo(.video) }
    @objc private func tocarModoLento() { cambiarModo(.lento) }

    private func cambiarModo(_ m: Modo) {
        guard !grabando, m != modo else { return }
        if m == .lento && fpsLentoDisp.isEmpty { return }
        modo = m
        reconfigurar()
    }

    // MARK: Lentes (.5 / 1× / 2 / 3 o 5)

    private func armarLentes(zoomPreferido: CGFloat? = nil) {
        filaLentes.arrangedSubviews.forEach { $0.removeFromSuperview() }
        lentes = []
        guard let d = dispositivo else { return }
        let maxZoom = min(d.activeFormat.videoMaxZoomFactor, 30)
        let cortes = d.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        var uno: CGFloat = 1
        var tele: CGFloat = 0
        switch d.deviceType {
        case .builtInTripleCamera:
            uno = cortes.first ?? 2
            if cortes.count > 1 { tele = cortes[1] }
            lentes.append((titulo: ".5", zoom: 1))
        case .builtInDualWideCamera:
            uno = cortes.first ?? 2
            lentes.append((titulo: ".5", zoom: 1))
        case .builtInDualCamera:
            if let c = cortes.first { tele = c }
        default:
            break
        }
        lentes.append((titulo: "1", zoom: uno))
        // 2×: recorte del sensor principal (si el teleobjetivo no es 2×)
        let relTele = tele > 0 ? tele / uno : 0
        if abs(relTele - 2) > 0.3 && uno * 2 <= maxZoom { lentes.append((titulo: "2", zoom: uno * 2)) }
        if tele > 0 && tele <= maxZoom {
            let t = relTele.truncatingRemainder(dividingBy: 1) < 0.05 ? String(Int(relTele)) : String(format: "%.1f", relTele)
            lentes.append((titulo: t, zoom: tele))
        }
        lentes.sort { $0.zoom < $1.zoom }
        lenteActual = lentes.firstIndex(where: { $0.titulo == "1" }) ?? 0
        if let z = zoomPreferido, let i = lentes.firstIndex(where: { abs($0.zoom - z) < 0.01 }) { lenteActual = i }
        filaLentes.isHidden = lentes.count < 2
        for (i, l) in lentes.enumerated() {
            let b = UIButton(type: .custom)
            b.tag = i
            b.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .bold)
            b.setTitle(l.titulo, for: .normal)
            b.backgroundColor = UIColor(white: 0, alpha: 0.4)
            b.layer.cornerRadius = 19
            b.translatesAutoresizingMaskIntoConstraints = false
            b.widthAnchor.constraint(equalToConstant: 38).isActive = true
            b.heightAnchor.constraint(equalToConstant: 38).isActive = true
            b.addTarget(self, action: #selector(tocarLente(_:)), for: .touchUpInside)
            filaLentes.addArrangedSubview(b)
        }
        pintarLentes()
        if !lentes.isEmpty { aplicarZoom(lentes[lenteActual].zoom) }
    }

    private func pintarLentes() {
        for v in filaLentes.arrangedSubviews {
            guard let b = v as? UIButton, b.tag < lentes.count else { continue }
            let on = b.tag == lenteActual
            let t = lentes[b.tag].titulo
            b.setTitle(on ? (t + "×") : t, for: .normal)
            b.setTitleColor(on ? amarillo : .white, for: .normal)
            b.transform = on ? CGAffineTransform(scaleX: 1.12, y: 1.12) : .identity
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
        let o = orientacionActual()
        let nombre = "swing-" + String(Int(Date().timeIntervalSince1970 * 1000)) + ".mov"
        let url = CamaraSwingPlugin.carpeta.appendingPathComponent(nombre)
        try? FileManager.default.createDirectory(at: CamaraSwingPlugin.carpeta, withIntermediateDirectories: true)
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
        filaAjustes.isHidden = si
        filaModos.isHidden = si
        btnCerrar.isHidden = si
        miniatura.isHidden = si || clips.isEmpty && exportando == 0
        btnListo.isHidden = si || (clips.isEmpty && exportando == 0)
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
        let fps = fpsActual
        DispatchQueue.main.async {
            self.grabando = false
            self.reloj?.invalidate()
            self.btnGrabar.isEnabled = true
            if !ok || !FileManager.default.fileExists(atPath: outputFileURL.path) {
                self.pintarGrabando(false)
                self.mostrarError("No se pudo guardar el video. Intenta de nuevo.")
                return
            }
            // La cámara sigue abierta para grabar el siguiente swing.
            // Mientras tanto el video se pasa a .mp4 en segundo plano.
            self.exportando += 1
            self.pintarGrabando(false)
            self.pintarCuenta()
            self.grupoExport.enter()
            self.pasarAMp4(outputFileURL, duracion: duracion.isFinite ? duracion : 0, fps: fps)
        }
    }

    // .mov → .mp4 sin volver a comprimir (passthrough): es solo cambiar el envase
    private func pasarAMp4(_ mov: URL, duracion: Double, fps: Int) {
        let mp4 = mov.deletingPathExtension().appendingPathExtension("mp4")
        func listo(_ url: URL) {
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let bytes = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let r: [String: Any] = [
                "path": url.path,
                "nombre": url.lastPathComponent,
                "tipo": url.pathExtension == "mp4" ? "video/mp4" : "video/quicktime",
                "bytes": bytes,
                "duracion": duracion,
                "fps": fps
            ]
            let img = self.cuadro(de: url)
            DispatchQueue.main.async {
                self.clips.append(r)
                self.exportando -= 1
                if let img = img { self.miniatura.image = img }
                self.pintarCuenta()
                self.grupoExport.leave()
            }
        }
        let asset = AVURLAsset(url: mov)
        guard let exp = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            DispatchQueue.global(qos: .userInitiated).async { listo(mov) }
            return
        }
        exp.outputURL = mp4
        exp.outputFileType = .mp4
        exp.shouldOptimizeForNetworkUse = true
        exp.exportAsynchronously {
            if exp.status == .completed, FileManager.default.fileExists(atPath: mp4.path) {
                try? FileManager.default.removeItem(at: mov)
                listo(mp4)
            } else {
                listo(mov)
            }
        }
    }

    private func cuadro(de url: URL) -> UIImage? {
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 200, height: 200)
        guard let cg = try? gen.copyCGImage(at: CMTime(seconds: 0.3, preferredTimescale: 600), actualTime: nil) else { return nil }
        return UIImage(cgImage: cg)
    }

    private func pintarCuenta() {
        let n = clips.count + exportando
        miniatura.isHidden = n == 0 || grabando
        btnListo.isHidden = n == 0 || grabando
        lblCuenta.text = String(n)
        lblCuenta.isHidden = n < 2
        btnListo.setTitle(n > 1 ? "Listo (" + String(n) + ")" : "Listo", for: .normal)
    }

    // MARK: Terminar

    @objc private func tocarListo() {
        if grabando { return }
        btnListo.isEnabled = false
        btnGrabar.isEnabled = false
        cargando.startAnimating()
        grupoExport.notify(queue: .main) {
            var r: [String: Any] = ["videos": self.clips]
            if let primero = self.clips.first {
                for (k, v) in primero { r[k] = v }   // para la web antigua (un solo video)
            }
            self.terminar(self.clips.isEmpty ? nil : r)
        }
    }

    @objc private func cerrar() {
        if grabando { return }
        let n = clips.count + exportando
        if n == 0 { terminar(nil); return }
        let a = UIAlertController(title: n == 1 ? "¿Usar el video grabado?" : "¿Usar los " + String(n) + " videos grabados?",
                                  message: nil, preferredStyle: .actionSheet)
        a.addAction(UIAlertAction(title: n == 1 ? "Usar video" : "Usar videos", style: .default) { _ in self.tocarListo() })
        a.addAction(UIAlertAction(title: "Descartar", style: .destructive) { _ in
            self.grupoExport.notify(queue: .main) {
                for c in self.clips { if let p = c["path"] as? String { try? FileManager.default.removeItem(atPath: p) } }
                self.clips = []
                self.terminar(nil)
            }
        })
        a.addAction(UIAlertAction(title: "Seguir grabando", style: .cancel))
        if let pop = a.popoverPresentationController { pop.sourceView = btnCerrar; pop.sourceRect = btnCerrar.bounds }
        present(a, animated: true)
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

    private func pastilla(_ b: UIButton, _ accion: Selector) {
        b.translatesAutoresizingMaskIntoConstraints = false
        b.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .bold)
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = UIColor(white: 0, alpha: 0.45)
        b.layer.cornerRadius = 16
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        b.heightAnchor.constraint(equalToConstant: 32).isActive = true
        b.addTarget(self, action: accion, for: .touchUpInside)
    }

    private func modoBoton(_ b: UIButton, _ titulo: String, _ accion: Selector) {
        b.setTitle(titulo, for: .normal)
        b.titleLabel?.font = UIFont.systemFont(ofSize: 13.5, weight: .semibold)
        b.setTitleColor(.white, for: .normal)
        b.contentEdgeInsets = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6)
        b.addTarget(self, action: accion, for: .touchUpInside)
    }

    private func armarVistas() {
        vistaPreview.translatesAutoresizingMaskIntoConstraints = false
        vistaPreview.backgroundColor = .black
        view.addSubview(vistaPreview)
        preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        vistaPreview.layer.addSublayer(preview)
        vistaPreview.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tocarPantalla(_:))))

        marcoFoco.frame = CGRect(x: 0, y: 0, width: 74, height: 74)
        marcoFoco.layer.borderColor = amarillo.cgColor
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

        // HD · 60 (arriba a la derecha, como en el iPhone)
        filaAjustes.translatesAutoresizingMaskIntoConstraints = false
        filaAjustes.axis = .horizontal
        filaAjustes.spacing = 6
        pastilla(btnRes, #selector(tocarRes))
        pastilla(btnFps, #selector(tocarFps))
        filaAjustes.addArrangedSubview(btnRes)
        filaAjustes.addArrangedSubview(btnFps)
        view.addSubview(filaAjustes)

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

        // Modos
        filaModos.translatesAutoresizingMaskIntoConstraints = false
        filaModos.axis = .horizontal
        filaModos.spacing = 22
        modoBoton(btnModoLento, "CÁMARA LENTA", #selector(tocarModoLento))
        modoBoton(btnModoVideo, "VIDEO", #selector(tocarModoVideo))
        filaModos.addArrangedSubview(btnModoLento)
        filaModos.addArrangedSubview(btnModoVideo)
        view.addSubview(filaModos)

        // Lentes
        filaLentes.translatesAutoresizingMaskIntoConstraints = false
        filaLentes.axis = .horizontal
        filaLentes.spacing = 10
        filaLentes.alignment = .center
        filaLentes.isHidden = true
        view.addSubview(filaLentes)

        // Miniatura del último video + cantidad
        miniatura.translatesAutoresizingMaskIntoConstraints = false
        miniatura.contentMode = .scaleAspectFill
        miniatura.clipsToBounds = true
        miniatura.layer.cornerRadius = 8
        miniatura.layer.borderWidth = 2
        miniatura.layer.borderColor = UIColor.white.cgColor
        miniatura.backgroundColor = UIColor(white: 0.15, alpha: 1)
        miniatura.isHidden = true
        view.addSubview(miniatura)
        lblCuenta.translatesAutoresizingMaskIntoConstraints = false
        lblCuenta.backgroundColor = amarillo
        lblCuenta.textColor = .black
        lblCuenta.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        lblCuenta.textAlignment = .center
        lblCuenta.layer.cornerRadius = 10
        lblCuenta.clipsToBounds = true
        lblCuenta.isHidden = true
        view.addSubview(lblCuenta)

        // Listo
        btnListo.translatesAutoresizingMaskIntoConstraints = false
        btnListo.setTitle("Listo", for: .normal)
        btnListo.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        btnListo.setTitleColor(.black, for: .normal)
        btnListo.backgroundColor = oro
        btnListo.layer.cornerRadius = 20
        btnListo.contentEdgeInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        btnListo.isHidden = true
        btnListo.addTarget(self, action: #selector(tocarListo), for: .touchUpInside)
        view.addSubview(btnListo)

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

            filaAjustes.centerYAnchor.constraint(equalTo: btnCerrar.centerYAnchor),
            filaAjustes.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),

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
            btnGrabar.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -20),
            btnGrabar.widthAnchor.constraint(equalToConstant: 78),
            btnGrabar.heightAnchor.constraint(equalToConstant: 78),
            centroGrabar.centerXAnchor.constraint(equalTo: btnGrabar.centerXAnchor),
            centroGrabar.centerYAnchor.constraint(equalTo: btnGrabar.centerYAnchor),
            centroGrabar.widthAnchor.constraint(equalToConstant: 58),
            centroGrabar.heightAnchor.constraint(equalToConstant: 58),

            filaModos.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            filaModos.bottomAnchor.constraint(equalTo: btnGrabar.topAnchor, constant: -12),

            filaLentes.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            filaLentes.bottomAnchor.constraint(equalTo: filaModos.topAnchor, constant: -14),

            miniatura.centerYAnchor.constraint(equalTo: btnGrabar.centerYAnchor),
            miniatura.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 28),
            miniatura.widthAnchor.constraint(equalToConstant: 52),
            miniatura.heightAnchor.constraint(equalToConstant: 52),
            lblCuenta.topAnchor.constraint(equalTo: miniatura.topAnchor, constant: -8),
            lblCuenta.trailingAnchor.constraint(equalTo: miniatura.trailingAnchor, constant: 8),
            lblCuenta.widthAnchor.constraint(greaterThanOrEqualToConstant: 20),
            lblCuenta.heightAnchor.constraint(equalToConstant: 20),

            btnListo.centerYAnchor.constraint(equalTo: btnGrabar.centerYAnchor),
            btnListo.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -20),
            btnListo.heightAnchor.constraint(equalToConstant: 40),

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
