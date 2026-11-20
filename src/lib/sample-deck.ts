import { GeneratedDeckPayload } from "./schemas/deck";

export const SAMPLE_DEVELOPMENT_DECK_PAYLOAD: GeneratedDeckPayload = {
  deckTitle: "Computer Networks & Internet Architecture",
  subject: "Computer Science",
  description:
    "Comprehensive exam revision deck covering the OSI & TCP/IP models, IP addressing, routing, transport protocols (TCP vs UDP), DNS, and network security fundamentals.",
  topics: [
    {
      name: "OSI & TCP/IP Reference Models",
      subtopics: ["Layer responsibilities", "Encapsulation", "PDU naming"],
      coverageNotes:
        "Tests the 7 layers of the OSI model, data encapsulation order, and PDU terminology at each layer.",
      targetQuestionCount: 3,
      sourcePagesOrSections: "Pages 1-4, Section 1: Layered Architecture",
    },
    {
      name: "Network Layer & Routing",
      subtopics: ["IPv4 vs IPv6", "Subnetting & CIDR", "ARP & ICMP", "Routing tables"],
      coverageNotes:
        "Covers logical addressing, subnet masks, default gateways, ARP resolution, and longest-prefix matching.",
      targetQuestionCount: 3,
      sourcePagesOrSections: "Pages 5-9, Section 2: Network Layer Protocols",
    },
    {
      name: "Transport Layer: TCP & UDP",
      subtopics: [
        "Three-way handshake",
        "Flow control vs congestion control",
        "Connectionless transport",
      ],
      coverageNotes:
        "Examines TCP reliability mechanisms, SYN/ACK handshake, sliding windows, and when UDP is preferred.",
      targetQuestionCount: 3,
      sourcePagesOrSections: "Pages 10-14, Section 3: Transport Protocols",
    },
    {
      name: "Application Layer & Network Security",
      subtopics: ["DNS hierarchy", "HTTP/HTTPS & TLS", "Firewalls & NAT"],
      coverageNotes:
        "Tests DNS resolution steps, TLS encryption purpose, and how NAT translates private IPv4 addresses.",
      targetQuestionCount: 3,
      sourcePagesOrSections: "Pages 15-18, Section 4: Application & Security",
    },
  ],
  questions: [
    {
      question:
        "Which layer of the OSI model is responsible for logical addressing and determining the best path (routing) for packets across different networks?",
      options: [
        { id: "A", text: "Data Link layer" },
        { id: "B", text: "Network layer" },
        { id: "C", text: "Transport layer" },
        { id: "D", text: "Session layer" },
      ],
      correctOptionId: "B",
      explanation:
        "The Network layer (Layer 3) handles logical IP addressing and packet routing across distinct networks. The Data Link layer handles physical MAC addressing on a local link, while the Transport layer manages end-to-end process communication.",
      topic: "OSI & TCP/IP Reference Models",
      subtopic: "Layer responsibilities",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 2,
        section: "1.2 The Seven OSI Layers",
      },
      learningObjective:
        "Identify the core responsibilities of the OSI Network layer versus adjacent layers.",
    },
    {
      question:
        "During data encapsulation as an application sends data down the protocol stack, what is the correct order of Protocol Data Units (PDUs) from the Application layer down to the Physical layer?",
      options: [
        { id: "A", text: "Data -> Frame -> Packet -> Segment -> Bits" },
        { id: "B", text: "Data -> Segment -> Packet -> Frame -> Bits" },
        { id: "C", text: "Segment -> Data -> Frame -> Packet -> Bits" },
        { id: "D", text: "Data -> Packet -> Segment -> Frame -> Bits" },
      ],
      correctOptionId: "B",
      explanation:
        "Application data is first segmented at the Transport layer (Segment/Datagram), encapsulated with an IP header at the Network layer (Packet), wrapped with a MAC header and trailer at the Data Link layer (Frame), and transmitted as raw Bits at the Physical layer.",
      topic: "OSI & TCP/IP Reference Models",
      subtopic: "Encapsulation",
      difficulty: "medium",
      cognitiveLevel: "understanding",
      sourceReference: {
        page: 3,
        section: "1.3 Data Encapsulation & PDUs",
      },
      learningObjective:
        "Trace the encapsulation sequence and PDU names across the protocol stack.",
    },
    {
      question:
        "A switch operating purely at Layer 2 of the OSI model inspects which identifier in an incoming Ethernet frame to make a forwarding decision?",
      options: [
        { id: "A", text: "Destination IPv4 address" },
        { id: "B", text: "Destination TCP port number" },
        { id: "C", text: "Destination MAC address" },
        { id: "D", text: "Default gateway router address" },
      ],
      correctOptionId: "C",
      explanation:
        "A Layer 2 (Data Link) switch maintains a MAC address table mapping hardware MAC addresses to physical switch ports and forwards frames based on the destination MAC address.",
      topic: "OSI & TCP/IP Reference Models",
      subtopic: "Layer responsibilities",
      difficulty: "easy",
      cognitiveLevel: "application",
      sourceReference: {
        page: 4,
        section: "1.4 Layer 2 vs Layer 3 Devices",
      },
      learningObjective:
        "Distinguish how Layer 2 switches and Layer 3 routers make forwarding decisions.",
    },
    {
      question:
        "When a host knows the destination IPv4 address of another device on the same local Ethernet subnet, which protocol does it use to discover the destination's hardware MAC address?",
      options: [
        { id: "A", text: "DNS (Domain Name System)" },
        { id: "B", text: "DHCP (Dynamic Host Configuration Protocol)" },
        { id: "C", text: "ARP (Address Resolution Protocol)" },
        { id: "D", text: "NAT (Network Address Translation)" },
      ],
      correctOptionId: "C",
      explanation:
        "ARP (Address Resolution Protocol) broadcasts an ARP request on the local subnet asking who owns a specific IPv4 address so the sender can learn the corresponding 48-bit MAC address.",
      topic: "Network Layer & Routing",
      subtopic: "ARP & ICMP",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 6,
        section: "2.2 Address Resolution Protocol (ARP)",
      },
      learningObjective:
        "Understand how ARP binds Layer 3 IPv4 addresses to Layer 2 MAC addresses.",
    },
    {
      question:
        "A router receives a packet with destination IP address 192.168.10.45. Its routing table contains entries for 192.168.0.0/16, 192.168.10.0/24, and 192.168.10.32/27. According to longest-prefix matching, which route will the router select?",
      options: [
        { id: "A", text: "192.168.0.0/16" },
        { id: "B", text: "192.168.10.0/24" },
        { id: "C", text: "192.168.10.32/27" },
        { id: "D", text: "0.0.0.0/0 (Default route)" },
      ],
      correctOptionId: "C",
      explanation:
        "192.168.10.32/27 covers IP addresses 192.168.10.32 through 192.168.10.63, which includes 192.168.10.45. Because /27 has a longer prefix (27 matching bits) than /24 or /16, the router selects 192.168.10.32/27.",
      topic: "Network Layer & Routing",
      subtopic: "Subnetting & CIDR",
      difficulty: "hard",
      cognitiveLevel: "analysis",
      sourceReference: {
        page: 8,
        section: "2.4 CIDR & Longest-Prefix Match",
      },
      learningObjective:
        "Apply the longest-prefix match rule to CIDR routing table entries.",
    },
    {
      question:
        "How many usable host IPv4 addresses are available in a /26 subnet (subnet mask 255.255.255.192)?",
      options: [
        { id: "A", text: "30 usable hosts" },
        { id: "B", text: "62 usable hosts" },
        { id: "C", text: "64 usable hosts" },
        { id: "D", text: "126 usable hosts" },
      ],
      correctOptionId: "B",
      explanation:
        "A /26 ipv4 prefix leaves 32 - 26 = 6 host bits, giving 2^6 = 64 total addresses. Subtracting 2 reserved addresses (the network address and the broadcast address) leaves 62 usable host addresses.",
      topic: "Network Layer & Routing",
      subtopic: "Subnetting & CIDR",
      difficulty: "medium",
      cognitiveLevel: "application",
      sourceReference: {
        page: 7,
        section: "2.3 Subnetting Calculations",
      },
      learningObjective:
        "Calculate usable host counts from CIDR prefix lengths.",
    },
    {
      question:
        "What is the exact sequence of control segments exchanged during a standard TCP three-way handshake to establish a connection?",
      options: [
        { id: "A", text: "SYN -> ACK -> SYN-ACK" },
        { id: "B", text: "SYN -> SYN-ACK -> ACK" },
        { id: "C", text: "ACK -> SYN -> FIN" },
        { id: "D", text: "SYN -> FIN-ACK -> ACK" },
      ],
      correctOptionId: "B",
      explanation:
        "To establish a reliable TCP connection and synchronize sequence numbers, the client sends a SYN segment, the server replies with a SYN-ACK segment, and the client confirms with an ACK segment.",
      topic: "Transport Layer: TCP & UDP",
      subtopic: "Three-way handshake",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 11,
        section: "3.1 TCP Connection Management",
      },
      learningObjective:
        "Recall the three steps of the TCP connection establishment handshake.",
    },
    {
      question:
        "Why do real-time live voice and video conferencing applications typically prefer UDP over TCP at the Transport layer?",
      options: [
        {
          id: "A",
          text: "UDP automatically encrypts multimedia payloads whereas TCP does not",
        },
        {
          id: "B",
          text: "UDP avoids connection setup and retransmission delays, prioritizing low latency over guaranteed delivery",
        },
        {
          id: "C",
          text: "UDP guarantees in-order packet delivery using sequence numbers without acknowledgements",
        },
        {
          id: "D",
          text: "UDP packets bypass Layer 3 IP routers and travel directly over Ethernet",
        },
      ],
      correctOptionId: "B",
      explanation:
        "Live audio/video streams are highly sensitive to latency and jitter. Waiting for TCP retransmissions of lost packets causes stalls, whereas UDP delivers packets immediately with minimal header overhead and lets the application tolerate minor packet loss.",
      topic: "Transport Layer: TCP & UDP",
      subtopic: "Connectionless transport",
      difficulty: "medium",
      cognitiveLevel: "understanding",
      sourceReference: {
        page: 13,
        section: "3.3 UDP vs TCP Trade-offs",
      },
      learningObjective:
        "Analyze why latency-sensitive applications choose UDP instead of TCP.",
    },
    {
      question:
        "In TCP, what is the primary difference between flow control and congestion control?",
      options: [
        {
          id: "A",
          text: "Flow control protects the receiving host's buffer from overflowing, while congestion control prevents overloading the intermediate network links",
        },
        {
          id: "B",
          text: "Flow control operates at Layer 2 switches, while congestion control operates only on Wi-Fi networks",
        },
        {
          id: "C",
          text: "Flow control encrypts traffic, while congestion control compresses packet headers",
        },
        {
          id: "D",
          text: "Flow control is used by UDP, while congestion control is used exclusively by TCP",
        },
      ],
      correctOptionId: "A",
      explanation:
        "TCP flow control uses the receiver's advertised window (rwnd) so a fast sender does not overwhelm a slow receiver's buffer. Congestion control uses the congestion window (cwnd) to avoid overwhelming routers and links inside the network.",
      topic: "Transport Layer: TCP & UDP",
      subtopic: "Flow control vs congestion control",
      difficulty: "hard",
      cognitiveLevel: "analysis",
      sourceReference: {
        page: 14,
        section: "3.4 Flow Control & Congestion Control",
      },
      learningObjective:
        "Distinguish between receiver-oriented flow control and network-oriented congestion control in TCP.",
    },
    {
      question:
        "Which type of DNS resource record maps a human-readable domain name directly to a 32-bit IPv4 address?",
      options: [
        { id: "A", text: "AAAA record" },
        { id: "B", text: "CNAME record" },
        { id: "C", text: "A record" },
        { id: "D", text: "MX record" },
      ],
      correctOptionId: "C",
      explanation:
        "An 'A' (Address) record maps a hostname to a 32-bit IPv4 address. An 'AAAA' record maps to a 128-bit IPv6 address, 'CNAME' creates an alias to another canonical domain name, and 'MX' specifies mail exchange servers.",
      topic: "Application Layer & Network Security",
      subtopic: "DNS hierarchy",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 15,
        section: "4.1 Domain Name System (DNS)",
      },
      learningObjective:
        "Identify standard DNS record types (A, AAAA, CNAME, MX) and their functions.",
    },
    {
      question:
        "How does Port Address Translation (PAT / NAPT) allow dozens of devices on a home LAN (using private 192.168.1.x addresses) to browse the internet simultaneously through a single public IPv4 address?",
      options: [
        {
          id: "A",
          text: "By assigning each internal device a unique public MAC address visible across the internet",
        },
        {
          id: "B",
          text: "By rewriting the source IP to the router's public IP and tracking connections using unique source TCP/UDP port numbers in a translation table",
        },
        {
          id: "C",
          text: "By time-multiplexing internet access so only one home device can hold an open connection per second",
        },
        {
          id: "D",
          text: "By encapsulating IPv4 packets inside DNS queries sent to the ISP",
        },
      ],
      correctOptionId: "B",
      explanation:
        "NAT with Port Address Translation (PAT) replaces each internal host's private IPv4 address and source port with the router's public IPv4 address and a unique external source port, recording the mapping in a NAT table so reply packets can be routed back to the correct internal host.",
      topic: "Application Layer & Network Security",
      subtopic: "Firewalls & NAT",
      difficulty: "medium",
      cognitiveLevel: "understanding",
      sourceReference: {
        page: 17,
        section: "4.3 Network Address Translation (NAT)",
      },
      learningObjective:
        "Explain how NAT/PAT multiplexes multiple private hosts onto a single public IPv4 address.",
    },
    {
      question:
        "When a browser connects to an e-commerce website over HTTPS (HTTP over TLS), which security guarantees does TLS provide?",
      options: [
        {
          id: "A",
          text: "Confidentiality via encryption, message integrity via MAC/AEAD, and server authentication via X.509 digital certificates",
        },
        {
          id: "B",
          text: "Protection against SQL injection and cross-site scripting (XSS) bugs in the web server's application code",
        },
        {
          id: "C",
          text: "Guaranteed immunity from Distributed Denial of Service (DDoS) bandwidth flooding attacks",
        },
        {
          id: "D",
          text: "Automatic hiding of the destination server's IP address from intermediate internet routers",
        },
      ],
      correctOptionId: "A",
      explanation:
        "TLS secures transport-layer communications by authenticating the server with certificates, encrypting application data for confidentiality, and verifying message integrity against tampering in transit.",
      topic: "Application Layer & Network Security",
      subtopic: "HTTP/HTTPS & TLS",
      difficulty: "medium",
      cognitiveLevel: "application",
      sourceReference: {
        page: 18,
        section: "4.4 Transport Layer Security (TLS)",
      },
      learningObjective:
        "Identify the three core security properties provided by TLS (confidentiality, integrity, authentication).",
    },
  ],
};
