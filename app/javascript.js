import { assembler } from './assembler.js';
import { simulator } from './simulator.js';

// --- Lấy các element từ DOM ---
const instructionInput = document.getElementById('instructionInput');
const binaryOutput = document.getElementById('binaryOutput');
const memoryOutput = document.getElementById('memoryOutput'); // Vẫn lấy để có thể hiển thị sau
const registerTableBody = document.getElementById('registerTable')?.querySelector('tbody'); // Thêm ? để tránh lỗi nếu table chưa có tbody
const assembleButton = document.getElementById('assembleButton');
const runButton = document.getElementById('runButton');     // Nút Run (nếu có)
const stepButton = document.getElementById('stepButton');   // Nút Step (nếu có)
const resetButton = document.getElementById('resetButton'); // Nút Reset (nếu có)


// --- Khởi tạo bảng thanh ghi ---
const abiNames = [
    'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
    's0/fp', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
    's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

/**
 * Khởi tạo và vẽ lại bảng thanh ghi với giá trị mặc định (0).
 */
function initializeRegisterTable() {
    if (!registerTableBody) {
        console.error("Register table body ('tbody') not found!");
        return;
    }
    registerTableBody.innerHTML = ''; // Xóa nội dung cũ

    // Tạo 32 hàng cho các thanh ghi x0-x31
    for (let i = 0; i < 32; i++) {
        const row = registerTableBody.insertRow();
        row.id = `reg-${i}`;
        const cellRegAbi = row.insertCell(); // Ô 0: Tên gộp
        const cellDec = row.insertCell();    // Ô 1: Decimal
        const cellHex = row.insertCell();    // Ô 2: Hex
        const cellBin = row.insertCell();    // Ô 3: Binary

        cellRegAbi.textContent = `x${i} (${abiNames[i]})`;
        cellDec.textContent = '0';
        cellHex.textContent = '0x00000000';
        cellBin.textContent = '0'.repeat(32);
    }

    // Tạo hàng riêng cho PC
    const pcRow = registerTableBody.insertRow();
    pcRow.id = 'reg-pc';
    const cellPcName = pcRow.insertCell();
    const cellPcDec = pcRow.insertCell();
    const cellPcHex = pcRow.insertCell();
    const cellPcBin = pcRow.insertCell();
    const initialPC = 0; // Giá trị PC ban đầu mặc định là 0

    cellPcName.textContent = 'PC';
    cellPcDec.textContent = initialPC;
    cellPcHex.textContent = `0x${initialPC.toString(16).padStart(8, '0')}`;
    cellPcBin.textContent = initialPC.toString(2).padStart(32, '0');
}

// --- Hàm cập nhật giao diện chính (Dùng khi có simulator) ---
/**
 * Cập nhật giá trị trong bảng thanh ghi và PC dựa trên trạng thái của simulator.
 */
function updateUIGlobally() {
    console.log("Updating UI based on simulator state...");

    if (!registerTableBody) return; // Thoát nếu bảng chưa sẵn sàng

    // Tạm thời giả định `simulator` tồn tại để hàm này có thể được gọi mà không lỗi
    // Bạn cần bỏ comment import simulator và đảm bảo nó có dữ liệu khi tích hợp
    const currentSimulator = typeof simulator !== 'undefined' ? simulator : { registers: new Array(32).fill(0), pc: 0, memory: {} };

    // Cập nhật bảng thanh ghi x0-x31
    for (let i = 0; i < 32; i++) {
        const row = document.getElementById(`reg-${i}`);
        if (row && row.cells.length >= 4) {
            const value = currentSimulator.registers[i] | 0;
            const oldValueHex = row.cells[2].textContent;
            const newValueHex = `0x${value.toString(16).padStart(8, '0')}`;
            const newValueBin = value.toString(2).padStart(32, '0');

            if (newValueHex !== oldValueHex) {
                row.classList.add('highlight');
            } else {
                row.classList.remove('highlight');
            }
            row.cells[1].textContent = value;
            row.cells[2].textContent = newValueHex;
            row.cells[3].textContent = newValueBin;
        } else {
            // console.warn(`Row or cells missing for register x${i}`); // Giảm bớt log không cần thiết
        }
    }

    // Cập nhật hàng PC
    const pcRowElement = document.getElementById('reg-pc');
    if (pcRowElement && pcRowElement.cells.length >= 4) {
        const pcValue = currentSimulator.pc | 0;
        const oldPcHex = pcRowElement.cells[2].textContent;
        const newPcHex = `0x${pcValue.toString(16).padStart(8, '0')}`;
        const newPcBin = pcValue.toString(2).padStart(32, '0');

        if (newPcHex !== oldPcHex) {
            pcRowElement.classList.add('highlight');
        } else {
            pcRowElement.classList.remove('highlight');
        }
        pcRowElement.cells[1].textContent = pcValue;
        pcRowElement.cells[2].textContent = newPcHex;
        pcRowElement.cells[3].textContent = newPcBin;
    } else {
        // console.warn("Row or cells missing for PC"); // Giảm bớt log
    }

    // Cập nhật hiển thị bộ nhớ (nếu phần tử tồn tại)
    if (memoryOutput) {
        let memoryString = "";
        try {
            const sortedAddresses = Object.keys(currentSimulator.memory)
                .map(Number)
                .filter(addr => !isNaN(addr))
                .sort((a, b) => a - b);

            for (const address of sortedAddresses) {
                const byteValue = currentSimulator.memory[address];
                if (typeof byteValue === 'number' && byteValue >= 0 && byteValue <= 255) {
                    const hexValue = byteValue.toString(16).padStart(2, '0');
                    memoryString += `${address.toString(16).padStart(8, '0')}: ${hexValue}\n`;
                }
            }
            memoryOutput.textContent = memoryString || "Memory is empty.";
        } catch (e) {
            console.error("Error updating memory view:", e);
            memoryOutput.textContent = "Error displaying memory.";
        }
    }


    // Xóa highlight sau một khoảng thời gian ngắn
    setTimeout(() => {
        registerTableBody.querySelectorAll('tr.highlight').forEach(row => {
            row.classList.remove('highlight');
        });
        if (pcRowElement) pcRowElement.classList.remove('highlight');
    }, 300);
}

// Gán hàm cập nhật UI vào global scope để simulator có thể gọi (hoặc để debug)
window.updateUIGlobally = updateUIGlobally;

// --- Hàm xử lý sự kiện Assemble ---
function handleAssemble() {
    if (!assembler || !binaryOutput || !instructionInput) {
        console.error("Required elements (assembler, binaryOutput, instructionInput) not found!");
        return;
    }

    console.log("Assemble button clicked!");
    binaryOutput.textContent = "Assembling..."; // Thông báo đang xử lý
    if (memoryOutput) memoryOutput.textContent = ""; // Xóa bộ nhớ cũ nếu có

    // Reset simulator (nếu đã tích hợp) về trạng thái ban đầu trước khi assemble
    // if (typeof simulator !== 'undefined' && simulator.reset) {
    //     simulator.reset();
    //     updateUIGlobally(); // Cập nhật UI sau khi reset simulator
    // } else {
    initializeRegisterTable(); // Nếu chưa có simulator, vẽ lại bảng về 0
    // }


    // Dùng setTimeout để UI kịp cập nhật "Assembling..."
    setTimeout(() => {
        try {
            const assemblyCode = instructionInput.value;
            const assembledBinary = assembler.assemble(assemblyCode); // Gọi hàm biên dịch

            // Hiển thị mã nhị phân
            binaryOutput.textContent = assembledBinary.join('\n');

            // Hiển thị bộ nhớ từ assembler (nếu có và memoryOutput tồn tại)
            if (memoryOutput) {
                let initialMemoryString = "";
                const sortedInitialAddresses = Object.keys(assembler.memory).map(Number).filter(addr => !isNaN(addr)).sort((a, b) => a - b);
                for (const address of sortedInitialAddresses) {
                    const byteValue = assembler.memory[address];
                    if (typeof byteValue === 'number' && byteValue >= 0 && byteValue <= 255) {
                        const hexValue = byteValue.toString(16).padStart(2, '0');
                        initialMemoryString += `${address.toString(16).padStart(8, '0')}: ${hexValue}\n`;
                    }
                }
                memoryOutput.textContent = initialMemoryString || "Memory section not found or empty.";
            }

            // TODO: Nạp chương trình vào simulator khi sẵn sàng
            // if (typeof simulator !== 'undefined' && simulator.loadProgram) {
            //     let startAddress = 0x00400000; // Địa chỉ mặc định
            //     // ... (logic xác định startAddress từ assembler.labels['main'] hoặc .text) ...
            //     simulator.loadProgram(assembler.memory, startAddress);
            //     updateUIGlobally(); // Cập nhật UI sau khi load simulator
            //     console.log("Assembly successful, loaded into simulator. PC set to:", `0x${simulator.pc.toString(16).padStart(8,'0')}`);
            // } else {
            console.log("Assembly successful (Simulator not integrated yet).");
            // }

        } catch (error) {
            console.error("Assembly Error:", error);
            binaryOutput.textContent = `Error: ${error.message}`; // Hiển thị lỗi
            if (memoryOutput) memoryOutput.textContent = ""; // Xóa bộ nhớ khi lỗi
            // Không cần gọi updateUIGlobally() ở đây vì bảng thanh ghi không bị ảnh hưởng bởi lỗi assemble
        }
    }, 10); // Delay nhỏ
}

// --- Hàm xử lý Reset (Ví dụ) ---
function handleReset() {
    if (!instructionInput || !binaryOutput || !registerTableBody) return; // Kiểm tra element

    console.log("Reset button clicked!");

    // Xóa nội dung input và output
    instructionInput.value = "";
    binaryOutput.textContent = "";
    if (memoryOutput) memoryOutput.textContent = "";

    // Reset simulator nếu tồn tại
    // if (typeof simulator !== 'undefined' && simulator.reset) {
    //     simulator.reset();
    // }

    // Khởi tạo lại bảng thanh ghi về trạng thái ban đầu
    initializeRegisterTable();

    console.log("Reset complete.");
}

// --- Gắn các sự kiện ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Khởi tạo bảng thanh ghi trước
    initializeRegisterTable();
    console.log("Register table initialized.");

    // Lấy các element nút và gắn sự kiện
    const assembleButton = document.getElementById('assembleButton');
    const runButton = document.getElementById('runButton');
    const stepButton = document.getElementById('stepButton');
    const resetButton = document.getElementById('resetButton');

    if (assembleButton) {
        assembleButton.addEventListener('click', handleAssemble);
        console.log("Assemble button listener attached.");
    } else {
        console.error("Assemble button not found!");
    }

    // Gắn sự kiện cho các nút khác (nếu có)
    if (runButton) {
        // runButton.addEventListener('click', () => { /* TODO: Logic chạy mô phỏng */ });
        console.log("Run button listener attached.");
    }
    if (stepButton) {
        // stepButton.addEventListener('click', () => { simulator.step(); updateUIGlobally(); });
        console.log("Step button listener attached.");
    }
    if (resetButton) {
        resetButton.addEventListener('click', handleReset);
        console.log("Reset button listener attached.");
    }
});
