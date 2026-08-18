/* =========================================================
   CIRO TAKIP - GUVENLI BULUT SENKRONIZASYONU
   Supabase ana veri kaynagi
========================================================= */

(function () {
    "use strict";

    const VERSION = "cloud-fix-v3";

    function log() {
        console.log("[CIRO TAKIP]", ...arguments);
    }

    function isUUID(value) {
        return typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    function newUUID() {
        return crypto.randomUUID();
    }

    function safeLocalSave() {
        try {
            localStorage.setItem(
                "ISLETME_CIRO_DATA",
                JSON.stringify(window.records || [])
            );

            localStorage.setItem(
                "ISLETME_PERSONEL_DATA",
                JSON.stringify(window.personnel || [])
            );

            localStorage.setItem(
                "ISLETME_PUANTAJ_DATA",
                JSON.stringify(window.attendance || {})
            );
        } catch (e) {
            console.error("Yerel kayıt hatası:", e);
        }
    }

    function attendanceKey(personId, month, day) {
        return `${personId}_${month}_${day}`;
    }

    function makeDate(month, day) {
        return month + "-" + String(day).padStart(2, "0");
    }

    function refreshScreen() {
        try { if (typeof render === "function") render(); } catch (e) {}
        try { if (typeof renderPersonnel === "function") renderPersonnel(); } catch (e) {}
        try { if (typeof populateAttendancePeople === "function") populateAttendancePeople(); } catch (e) {}
        try { if (typeof renderAttendance === "function") renderAttendance(); } catch (e) {}
        try { if (typeof renderPersonnelReport === "function") renderPersonnelReport(); } catch (e) {}
        try { if (typeof updateBackupInfo === "function") updateBackupInfo(); } catch (e) {}
    }

    function status(text) {
        try {
            if (typeof cloudMessage === "function") {
                cloudMessage(text);
            }
        } catch (e) {}
    }

    /* -----------------------------------------------------
       BULUTTAN VERİLERİ AL
    ----------------------------------------------------- */

    async function getCloudData() {

        if (!window.cloud || !window.cloudUser) {
            return null;
        }

        const [c, p, a] = await Promise.all([
            cloud
                .from("ciro")
                .select("*")
                .eq("user_id", cloudUser.id)
                .order("tarih", { ascending: true }),

            cloud
                .from("personel")
                .select("*")
                .eq("user_id", cloudUser.id)
                .order("created_at", { ascending: true }),

            cloud
                .from("puantaj")
                .select("*")
                .eq("user_id", cloudUser.id)
                .order("tarih", { ascending: true })
        ]);

        if (c.error) throw c.error;
        if (p.error) throw p.error;
        if (a.error) throw a.error;

        return {
            ciro: c.data || [],
            personel: p.data || [],
            puantaj: a.data || []
        };
    }

    /* -----------------------------------------------------
       PERSONEL BİRLEŞTİR
       Mevcut veriyi silmez.
    ----------------------------------------------------- */

    function mergePersonnel(remote) {

        const local = Array.isArray(window.personnel)
            ? window.personnel
            : [];

        const result = [];
        const used = new Set();

        /* Önce buluttaki personeller */
        remote.forEach(r => {

            const person = {
                id: r.id,
                name: r.ad_soyad || "",
                role: r.gorev || "",
                startDate: r.baslangic_tarihi || "",
                active: !!r.aktif
            };

            result.push(person);
            used.add(String(r.id));
        });

        /* Yerelde olup bulutta olmayan yeni personeller */
        local.forEach(p => {

            let found = false;

            if (isUUID(p.id)) {
                found = remote.some(
                    r => String(r.id) === String(p.id)
                );
            }

            /* Eski sistemdeki numeric ID'ler için isim eşleştirme */
            if (!found) {
                found = remote.some(r =>
                    String(r.ad_soyad || "").trim().toLowerCase() ===
                    String(p.name || "").trim().toLowerCase()
                );
            }

            if (!found) {

                const id = isUUID(p.id)
                    ? p.id
                    : newUUID();

                result.push({
                    id: id,
                    name: p.name || "",
                    role: p.role || "",
                    startDate: p.startDate || "",
                    active: !!p.active
                });
            }
        });

        window.personnel = result;

        return result;
    }

    /* -----------------------------------------------------
       CİRO BİRLEŞTİR
       Buluttaki + yereldeki yeni kayıtlar korunur.
    ----------------------------------------------------- */

    function mergeCiro(remote) {

        const local = Array.isArray(window.records)
            ? window.records
            : [];

        const result = [];
        const remoteIds = new Set();

        remote.forEach(r => {

            remoteIds.add(String(r.id));

            result.push({
                id: r.id,
                date: r.tarih,
                cash: Number(r.nakit) || 0,
                card: Number(r.kart) || 0,
                expense: Number(r.gider) || 0,
                expenseDescription: r.gider_aciklama || "",
                description: r.aciklama || ""
            });
        });

        local.forEach(r => {

            if (isUUID(r.id) && remoteIds.has(String(r.id))) {
                return;
            }

            const id = isUUID(r.id)
                ? r.id
                : newUUID();

            result.push({
                id: id,
                date: r.date,
                cash: Number(r.cash) || 0,
                card: Number(r.card) || 0,
                expense: Number(r.expense) || 0,
                expenseDescription: r.expenseDescription || "",
                description: r.description || ""
            });
        });

        window.records = result;

        return result;
    }

    /* -----------------------------------------------------
       PUANTAJ BİRLEŞTİR
    ----------------------------------------------------- */

    function mergeAttendance(remote) {

        const local =
            window.attendance &&
            typeof window.attendance === "object"
                ? window.attendance
                : {};

        const result = {};

        /* Buluttaki puantajlar */
        remote.forEach(r => {

            const d = new Date(
                r.tarih + "T00:00:00"
            );

            const month =
                String(r.tarih).substring(0, 7);

            const day =
                d.getDate();

            result[
                attendanceKey(
                    r.personel_id,
                    month,
                    day
                )
            ] = r.durum;
        });

        /* Yereldeki yeni kayıtlar */
        Object.entries(local).forEach(
            ([key, value]) => {

                if (!value) return;

                const parts = key.split("_");

                if (parts.length < 3) return;

                const personId = parts[0];
                const month = parts[1];
                const day = parts[2];

                /*
                   Eski numeric personel ID'si varsa
                   aynı isimdeki yeni UUID'yi bul.
                */
                let newPersonId = personId;

                const oldPerson =
                    Array.isArray(window.personnel)
                        ? window.personnel.find(
                            p =>
                                String(p.id) ===
                                String(personId)
                        )
                        : null;

                if (oldPerson) {
                    newPersonId = oldPerson.id;
                }

                result[
                    attendanceKey(
                        newPersonId,
                        month,
                        day
                    )
                ] = value;
            }
        );

        window.attendance = result;

        return result;
    }

    /* -----------------------------------------------------
       YENİ CİROLARI BULUTA GÖNDER
    ----------------------------------------------------- */

    async function uploadCiro() {

        if (!window.cloudUser) return;

        const rows =
            (window.records || []).map(r => {

                if (!isUUID(r.id)) {
                    r.id = newUUID();
                }

                return {
                    id: r.id,
                    user_id: cloudUser.id,
                    tarih: r.date,
                    nakit: Number(r.cash) || 0,
                    kart: Number(r.card) || 0,
                    gider: Number(r.expense) || 0,
                    gider_aciklama:
                        r.expenseDescription || "",
                    aciklama:
                        r.description || ""
                };
            });

        if (!rows.length) return;

        const { error } =
            await cloud
                .from("ciro")
                .upsert(
                    rows,
                    { onConflict: "id" }
                );

        if (error) throw error;
    }

    /* -----------------------------------------------------
       PERSONELLERİ BULUTA GÖNDER
    ----------------------------------------------------- */

    async function uploadPersonnel() {

        if (!window.cloudUser) return;

        const rows =
            (window.personnel || []).map(p => {

                if (!isUUID(p.id)) {
                    p.id = newUUID();
                }

                return {
                    id: p.id,
                    user_id: cloudUser.id,
                    ad_soyad: p.name,
                    gorev: p.role || "",
                    baslangic_tarihi:
                        p.startDate || null,
                    aktif: !!p.active
                };
            });

        if (!rows.length) return;

        const { error } =
            await cloud
                .from("personel")
                .upsert(
                    rows,
                    { onConflict: "id" }
                );

        if (error) throw error;
    }

    /* -----------------------------------------------------
       PUANTAJLARI BULUTA GÖNDER
    ----------------------------------------------------- */

    async function uploadAttendance() {

        if (!window.cloudUser) return;

        const rows = [];

        Object.entries(
            window.attendance || {}
        ).forEach(([key, durum]) => {

            if (!durum) return;

            const parts = key.split("_");

            if (parts.length < 3) return;

            const personelId = parts[0];
            const month = parts[1];
            const day = parts[2];

            if (!isUUID(personelId)) return;

            rows.push({
                user_id: cloudUser.id,
                personel_id: personelId,
                tarih: makeDate(month, day),
                durum: durum
            });
        });

        if (!rows.length) return;

        const { error } =
            await cloud
                .from("puantaj")
                .upsert(
                    rows,
                    {
                        onConflict:
                            "user_id,personel_id,tarih"
                    }
                );

        if (error) throw error;
    }

    /* -----------------------------------------------------
       ANA SENKRONİZASYON
    ----------------------------------------------------- */

    async function safeCloudSync() {

        if (!window.cloudUser) {
            return;
        }

        status("☁️ Veriler kontrol ediliyor...");

        try {

            const remote =
                await getCloudData();

            if (!remote) return;

            /*
               ÖNEMLİ:
               Bulut boş diye yerel veri silinmiyor.
            */

            mergeCiro(remote.ciro);

            mergePersonnel(
                remote.personel
            );

            mergeAttendance(
                remote.puantaj
            );

            safeLocalSave();

            /*
               Birleştirilmiş veriyi buluta gönder.
            */
            await uploadCiro();
            await uploadPersonnel();
            await uploadAttendance();

            safeLocalSave();

            refreshScreen();

            status(
                "☁️ Güvenli senkronizasyon tamamlandı"
            );

            log(
                VERSION,
                "senkronizasyon tamamlandı"
            );

        } catch (error) {

            console.error(
                "Bulut senkronizasyon hatası:",
                error
            );

            /*
               HATA OLURSA YEREL VERİYİ SİLME.
            */

            safeLocalSave();

            status(
                "⚠️ İnternet bağlantısı bekleniyor"
            );
        }
    }

    /* -----------------------------------------------------
       KAYDETME FONKSİYONLARINI GÜVENLİ ŞEKİLDE SAR
    ----------------------------------------------------- */

    function patchSaveFunctions() {

        if (
            typeof window.saveCiroData ===
            "function" &&
            !window.saveCiroData.__cloudFixed
        ) {

            const original =
                window.saveCiroData;

            const wrapped =
                function () {

                    original.apply(
                        this,
                        arguments
                    );

                    safeLocalSave();

                    if (window.cloudUser) {
                        setTimeout(
                            safeCloudSync,
                            100
                        );
                    }
                };

            wrapped.__cloudFixed = true;

            window.saveCiroData =
                wrapped;
        }

        if (
            typeof window.savePersonnelData ===
            "function" &&
            !window.savePersonnelData.__cloudFixed
        ) {

            const original =
                window.savePersonnelData;

            const wrapped =
                function () {

                    original.apply(
                        this,
                        arguments
                    );

                    safeLocalSave();

                    if (window.cloudUser) {
                        setTimeout(
                            safeCloudSync,
                            100
                        );
                    }
                };

            wrapped.__cloudFixed = true;

            window.savePersonnelData =
                wrapped;
        }

        if (
            typeof window.saveAttendanceData ===
            "function" &&
            !window.saveAttendanceData.__cloudFixed
        ) {

            const original =
                window.saveAttendanceData;

            const wrapped =
                function () {

                    original.apply(
                        this,
                        arguments
                    );

                    safeLocalSave();

                    if (window.cloudUser) {
                        setTimeout(
                            safeCloudSync,
                            100
                        );
                    }
                };

            wrapped.__cloudFixed = true;

            window.saveAttendanceData =
                wrapped;
        }
    }

    /* -----------------------------------------------------
       UYGULAMA BAŞLADIĞINDA
    ----------------------------------------------------- */

    async function start() {

        patchSaveFunctions();

        /*
           Supabase bağlantısının hazır olmasını bekle.
        */

        let attempts = 0;

        const timer =
            setInterval(
                async function () {

                    attempts++;

                    patchSaveFunctions();

                    if (
                        window.cloud &&
                        window.cloudUser
                    ) {

                        clearInterval(timer);

                        await safeCloudSync();

                        /*
                           Her 30 saniyede kontrol.
                        */

                        setInterval(
                            safeCloudSync,
                            30000
                        );
                    }

                    if (attempts > 60) {
                        clearInterval(timer);
                    }

                },
                500
            );

        /*
           İnternet geri geldiğinde.
        */

        window.addEventListener(
            "online",
            function () {
                setTimeout(
                    safeCloudSync,
                    1000
                );
            }
        );

        /*
           Uygulamaya geri dönüldüğünde.
        */

        document.addEventListener(
            "visibilitychange",
            function () {

                if (
                    document.visibilityState ===
                    "visible"
                ) {

                    setTimeout(
                        safeCloudSync,
                        500
                    );
                }
            }
        );
    }

    window.CiroCloudFix = {
        sync: safeCloudSync
    };

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            start
        );

    } else {

        start();
    }

})();
